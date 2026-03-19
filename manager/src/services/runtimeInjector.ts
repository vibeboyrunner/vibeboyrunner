import fs from "fs/promises";
import path from "path";
import { ManagerConfig } from "../types";
import { log } from "../utils/logger";
import { runCommand } from "../utils/process";

export class RuntimeInjector {
  constructor(private readonly config: ManagerConfig) {}

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
          "cursor"
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
          "cursor"
        );
    const workerDotCursorPath = path.join(workerConversationsRoot, "dot-cursor");

    await fs.mkdir(workerDotCursorPath, { recursive: true });
    await this.ensureOverrideIgnored(gitignorePath);

    const override = [
      "services:",
      `  ${this.config.appComposeServiceName}:`,
      "    volumes:",
      `      - ${mountSource}:${mountTarget}`,
      `      - ${workerDotCursorPath}:/root/.cursor`
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

    return [
      "set -e",
      "ensure_symlink() { src=\"$1\"; dst=\"$2\"; mkdir -p \"$(dirname \"$dst\")\"; if [ -L \"$dst\" ]; then ln -sfn \"$src\" \"$dst\"; return; fi; if [ -e \"$dst\" ]; then mv \"$dst\" \"${dst}.backup.$(date +%s)\"; fi; ln -sfn \"$src\" \"$dst\"; }",
      `ensure_symlink "${runtimeServicesPath}/gh/default" "/root/.config/gh"`,
      `ensure_symlink "${runtimeServicesPath}/cursor/default" "/root/.config/cursor"`,
      "if ! command -v gh >/dev/null 2>&1; then if [ \"$(id -u)\" != \"0\" ]; then echo 'WARN: cannot install gh as non-root'; else if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends gh curl ca-certificates || true; elif command -v apk >/dev/null 2>&1; then (apk add --no-cache gh curl ca-certificates bash || apk add --no-cache github-cli curl ca-certificates bash || true); elif command -v yum >/dev/null 2>&1; then yum install -y gh curl ca-certificates || true; else echo 'WARN: unsupported package manager for gh install'; fi; fi; fi",
      "if ! command -v agent >/dev/null 2>&1; then if [ \"$(id -u)\" != \"0\" ]; then echo 'WARN: cannot install cursor agent as non-root'; else if ! command -v curl >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl ca-certificates; fi; fi; if command -v curl >/dev/null 2>&1; then (curl -fsSL https://cursor.com/install | bash) || true; ln -sf /root/.local/bin/agent /usr/local/bin/agent || true; ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent || true; fi; fi; fi",
      "if command -v gh >/dev/null 2>&1 && ! gh --version >/dev/null 2>&1; then echo 'WARN: gh command exists but is not functional'; fi",
      "if command -v agent >/dev/null 2>&1 && ! agent --version >/dev/null 2>&1; then echo 'WARN: agent command exists but is not functional (likely libc mismatch)'; fi",
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
