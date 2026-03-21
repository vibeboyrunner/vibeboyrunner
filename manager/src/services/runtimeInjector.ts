import fs from "fs/promises";
import path from "path";
import { ManagerConfig } from "../types";
import { AgentProvider } from "../providers";
import { log } from "../utils/logger";
import { runCommand } from "../utils/process";

export class RuntimeInjector {
  private readonly agentProviders: AgentProvider[];

  constructor(
    private readonly config: ManagerConfig,
    agentProviders: Iterable<AgentProvider>
  ) {
    this.agentProviders = [...agentProviders];
    if (this.agentProviders.length === 0) {
      throw new Error("RuntimeInjector requires at least one agent provider");
    }
  }

  async ensureSharedServicesMountOverride(
    configRoot: string,
    workspaceName: string,
    appName: string,
    featureName?: string
  ): Promise<string> {
    const overridePath = path.join(configRoot, ".vbr-manager.override.yml");
    const mountSource = path.join(this.config.dindHomePath, "services");
    const mountTarget = path.join(this.config.dindHomePath, "services");
    const gitignorePath = path.join(configRoot, ".gitignore");
    const volumeMounts = new Set<string>();
    volumeMounts.add(`${mountSource}:${mountTarget}`);

    for (const provider of this.agentProviders) {
      const servicePaths = provider.getServicePaths();
      const workerConversationsRoot = featureName
        ? path.join(
            this.config.dindHomePath,
            "state",
            "conversations",
            "pools",
            workspaceName,
            "features",
            featureName,
            "apps",
            appName,
            "worker",
            servicePaths.conversationSubdir
          )
        : path.join(
            this.config.dindHomePath,
            "state",
            "conversations",
            "pools",
            workspaceName,
            "apps",
            appName,
            "worker",
            servicePaths.conversationSubdir
          );
      const workerDotDirPath = path.join(workerConversationsRoot, servicePaths.dotDir);
      await fs.mkdir(workerDotDirPath, { recursive: true });
      volumeMounts.add(`${workerDotDirPath}:${servicePaths.dotDirTarget}`);
    }

    await this.ensureOverrideIgnored(gitignorePath);

    const override = [
      "services:",
      `  ${this.config.appComposeServiceName}:`,
      "    volumes:",
      ...[...volumeMounts].map((mount) => `      - ${mount}`)
    ].join("\n");

    await fs.writeFile(overridePath, `${override}\n`, "utf8");
    return overridePath;
  }

  async injectIntoAppContainer(
    containerId: string,
    appName: string,
    workspaceName: string,
    featureName?: string
  ): Promise<string[]> {
    const warnings: string[] = [];
    const script = this.buildContainerSetupScript();

    try {
      const { stdout, stderr } = await runCommand("docker", ["exec", containerId, "sh", "-lc", script]);
      warnings.push(...this.extractWarnings(stdout));
      warnings.push(...this.extractWarnings(stderr));
      log("INFO", "Runtime setup completed for app container", {
        workspaceName,
        featureName: featureName || null,
        appName,
        containerId,
        warningsCount: warnings.length
      });
    } catch (error) {
      const warning = `Runtime setup failed for ${containerId}: ${String(error)}`;
      warnings.push(warning);
      log("WARN", "Runtime setup failed for app container", {
        workspaceName,
        featureName: featureName || null,
        appName,
        containerId,
        error: String(error)
      });
    }

    return warnings;
  }

  async getAppServiceContainerId(
    composePath: string,
    overridePath?: string,
    env?: NodeJS.ProcessEnv
  ): Promise<string> {
    const args = ["compose", "-f", composePath];
    if (overridePath) {
      args.push("-f", overridePath);
    }
    args.push("ps", "-q", this.config.appComposeServiceName);

    const { stdout } = await runCommand("docker", args, {
      cwd: path.dirname(composePath),
      env: env || process.env
    });
    const containerId = stdout.trim();
    if (!containerId) {
      throw new Error(`No running container found for compose service '${this.config.appComposeServiceName}'`);
    }
    return containerId;
  }

  private buildContainerSetupScript(): string {
    const runtimeServicesPath = `${this.config.dindHomePath}/services`;
    const providerConfigScripts = this.agentProviders
      .map((provider) => provider.buildConfigScript(runtimeServicesPath))
      .filter((script) => script.trim().length > 0);
    const providerInstallScripts = this.agentProviders
      .map((provider) => provider.buildInstallScript())
      .filter((script) => script.trim().length > 0);

    return [
      "set -e",
      "GIT_TARGET_VERSION='2.53.0'",
      "ensure_symlink() { src=\"$1\"; dst=\"$2\"; mkdir -p \"$(dirname \"$dst\")\"; if [ -L \"$dst\" ]; then ln -sfn \"$src\" \"$dst\"; return; fi; if [ -e \"$dst\" ]; then mv \"$dst\" \"${dst}.backup.$(date +%s)\"; fi; ln -sfn \"$src\" \"$dst\"; }",
      `ensure_symlink "${runtimeServicesPath}/gh/default" "/root/.config/gh"`,
      ...providerConfigScripts,
      "current_git_version=''; if command -v git >/dev/null 2>&1; then current_git_version=\"$(git --version 2>/dev/null | awk '{print $3}')\"; fi",
      "if [ \"$current_git_version\" != \"$GIT_TARGET_VERSION\" ]; then if [ \"$(id -u)\" != \"0\" ]; then echo 'WARN: cannot install git 2.53.0 as non-root'; else if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends build-essential gettext libcurl4-gnutls-dev libexpat1-dev libssl-dev zlib1g-dev xz-utils curl ca-certificates && curl -fsSL \"https://mirrors.edge.kernel.org/pub/software/scm/git/git-${GIT_TARGET_VERSION}.tar.xz\" -o /tmp/git.tar.xz && tar -xJf /tmp/git.tar.xz -C /tmp && make -C \"/tmp/git-${GIT_TARGET_VERSION}\" prefix=/usr/local -j\"$(nproc)\" all && make -C \"/tmp/git-${GIT_TARGET_VERSION}\" prefix=/usr/local install && rm -rf \"/tmp/git-${GIT_TARGET_VERSION}\" /tmp/git.tar.xz && apt-get purge -y --auto-remove build-essential gettext libcurl4-gnutls-dev libexpat1-dev libssl-dev zlib1g-dev xz-utils || true; else echo 'WARN: unsupported package manager for git 2.53.0 install'; fi; fi; fi",
      "if ! command -v gh >/dev/null 2>&1; then if [ \"$(id -u)\" != \"0\" ]; then echo 'WARN: cannot install gh as non-root'; else if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends gh curl ca-certificates || true; elif command -v apk >/dev/null 2>&1; then (apk add --no-cache gh curl ca-certificates bash || apk add --no-cache github-cli curl ca-certificates bash || true); elif command -v yum >/dev/null 2>&1; then yum install -y gh curl ca-certificates || true; else echo 'WARN: unsupported package manager for gh install'; fi; fi; fi",
      ...providerInstallScripts,
      "if command -v git >/dev/null 2>&1; then git_version_now=\"$(git --version 2>/dev/null | awk '{print $3}')\"; if [ \"$git_version_now\" != \"$GIT_TARGET_VERSION\" ]; then echo \"WARN: expected git ${GIT_TARGET_VERSION} but found ${git_version_now:-unknown}\"; fi; else echo 'WARN: git command is not available after runtime setup'; fi",
      "if command -v gh >/dev/null 2>&1 && ! gh --version >/dev/null 2>&1; then echo 'WARN: gh command exists but is not functional'; fi",
      "true"
    ].join("; ");
  }

  private async ensureOverrideIgnored(gitignorePath: string): Promise<void> {
    const entry = ".vbr-manager.override.yml";
    const current = await fs.readFile(gitignorePath, "utf8").catch(() => "");
    const lines = current
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.includes(entry)) {
      return;
    }
    const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
    await fs.writeFile(gitignorePath, `${current}${prefix}${entry}\n`, "utf8");
  }

  private extractWarnings(output: string): string[] {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("WARN: "));
  }
}
