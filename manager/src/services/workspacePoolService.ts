import fs from "fs/promises";
import path from "path";
import { ManagerConfig, AppConfig, AppResult } from "../types";
import { log } from "../utils/logger";
import { runCommand } from "../utils/process";
import { createAllAgentProviders, AgentProvider } from "../providers";
import { PortAllocator } from "./portAllocator";
import { RuntimeInjector } from "./runtimeInjector";

interface AgentProviderInfo {
  models: string[];
  defaultModel: string;
}

interface WorkspacePoolResult {
  workspaceName: string;
  featureName?: string;
  appsCount: number;
  results: AppResult[];
  agents: Record<string, AgentProviderInfo>;
}

interface DockerPsResult {
  includeAll: boolean;
  count: number;
  containers: Record<string, string>[];
  agents: Record<string, AgentProviderInfo>;
}

export interface AgentRunResult {
  containerId: string;
  threadId: string;
  prompt: string;
  stdout: string;
  stderr: string;
}

export class WorkspacePoolService {
  private readonly allocator: PortAllocator;
  private readonly runtimeInjector: RuntimeInjector;
  private readonly providers: Map<string, AgentProvider>;
  private readonly defaultProvider: AgentProvider;

  constructor(private readonly config: ManagerConfig) {
    this.providers = createAllAgentProviders(config.agentProviders, config.defaultAgentModel);
    this.defaultProvider = this.providers.values().next().value!;
    this.allocator = new PortAllocator(config.portPoolStart, config.portPoolEnd);
    this.runtimeInjector = new RuntimeInjector(config, this.defaultProvider);
  }

  getAgentsInfo(): Record<string, AgentProviderInfo> {
    const agents: Record<string, AgentProviderInfo> = {};
    for (const [name, provider] of this.providers) {
      agents[name] = {
        models: provider.getAvailableModels(),
        defaultModel: this.config.defaultAgentModel
      };
    }
    return agents;
  }

  async up(workspaceName: string): Promise<WorkspacePoolResult> {
    return this.upScoped(workspaceName);
  }

  async upFeature(workspaceName: string, featureName: string): Promise<WorkspacePoolResult> {
    return this.upScoped(workspaceName, featureName);
  }

  private async upScoped(workspaceName: string, featureName?: string): Promise<WorkspacePoolResult> {
    const appsRoot = await this.getAppsRoot(workspaceName, featureName);
    const allocatorState = await this.allocator.createState();
    const appDirs = await this.listAppDirs(appsRoot);
    const results: AppResult[] = [];

    for (const appName of appDirs) {
      const appRoot = path.join(appsRoot, appName);
      const configRoot = path.join(appRoot, ".vibeboyrunner");
      const composePath = path.join(configRoot, "docker-compose.yml");
      const configPath = path.join(configRoot, "config.json");

      const hasCompose = await this.exists(composePath);
      const hasConfig = await this.exists(configPath);
      if (!hasCompose || !hasConfig) {
        results.push({
          appName,
          status: "skipped",
          reason: "missing .vibeboyrunner/docker-compose.yml or config.json"
        });
        continue;
      }

      const appConfig = await this.readAppConfig(configPath);
      const portBindings = appConfig.bindings?.ports || {};
      const envBindings = appConfig.bindings?.envs || {};

      const resolvedPorts: Record<string, string> = {};
      for (const [variableName, defaultValue] of Object.entries(portBindings)) {
        const allocated = await this.allocator.allocate(allocatorState, defaultValue);
        resolvedPorts[variableName] = String(allocated);
      }

      const resolvedEnvs: Record<string, string> = {};
      for (const [variableName, defaultValue] of Object.entries(envBindings)) {
        resolvedEnvs[variableName] = String(defaultValue);
      }

      const composeEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DOCKER_BUILDKIT: "0",
        COMPOSE_DOCKER_CLI_BUILD: "0",
        ...resolvedEnvs,
        ...resolvedPorts
      };

      log("INFO", "Bringing app up with docker compose", {
        workspaceName,
        featureName: featureName || null,
        appName,
        configRoot,
        resolvedPorts,
        resolvedEnvs
      });

      const overridePath = await this.runtimeInjector.ensureSharedServicesMountOverride(
        configRoot,
        workspaceName,
        appName,
        featureName
      );

      await runCommand("docker", ["compose", "-f", composePath, "-f", overridePath, "up", "-d", "--build"], {
        cwd: configRoot,
        env: composeEnv
      });

      const containerId = await this.runtimeInjector.getAppServiceContainerId(composePath, overridePath, composeEnv);
      const runtimeWarnings = await this.runtimeInjector.injectIntoAppContainer(
        containerId,
        appName,
        workspaceName,
        featureName
      );

      results.push({
        appName,
        status: "up",
        ports: resolvedPorts,
        envs: resolvedEnvs,
        runtimeWarnings
      });
    }

    return {
      workspaceName,
      featureName,
      appsCount: results.length,
      results,
      agents: this.getAgentsInfo()
    };
  }

  async down(workspaceName: string): Promise<WorkspacePoolResult> {
    return this.downScoped(workspaceName);
  }

  async downFeature(workspaceName: string, featureName: string): Promise<WorkspacePoolResult> {
    return this.downScoped(workspaceName, featureName);
  }

  private async downScoped(workspaceName: string, featureName?: string): Promise<WorkspacePoolResult> {
    const appsRoot = await this.getAppsRoot(workspaceName, featureName);
    const appDirs = await this.listAppDirs(appsRoot);
    const results: AppResult[] = [];

    for (const appName of appDirs) {
      const appRoot = path.join(appsRoot, appName);
      const configRoot = path.join(appRoot, ".vibeboyrunner");
      const composePath = path.join(configRoot, "docker-compose.yml");
      const configPath = path.join(configRoot, "config.json");

      const hasCompose = await this.exists(composePath);
      if (!hasCompose) {
        results.push({
          appName,
          status: "skipped",
          reason: "missing .vibeboyrunner/docker-compose.yml"
        });
        continue;
      }

      const hasConfig = await this.exists(configPath);
      const appConfig = hasConfig ? await this.readAppConfig(configPath) : ({} as AppConfig);
      const portBindings = appConfig.bindings?.ports || {};
      const envBindings = appConfig.bindings?.envs || {};
      const composeEnv: NodeJS.ProcessEnv = {
        ...process.env,
        DOCKER_BUILDKIT: "0",
        COMPOSE_DOCKER_CLI_BUILD: "0"
      };
      for (const [variableName, defaultValue] of Object.entries(portBindings)) {
        composeEnv[variableName] = String(defaultValue);
      }
      for (const [variableName, defaultValue] of Object.entries(envBindings)) {
        composeEnv[variableName] = String(defaultValue);
      }

      log("INFO", "Bringing app down with docker compose", {
        workspaceName,
        featureName: featureName || null,
        appName,
        configRoot,
        hasConfig
      });

      const overridePath = await this.runtimeInjector.ensureSharedServicesMountOverride(
        configRoot,
        workspaceName,
        appName,
        featureName
      );
      await runCommand("docker", ["compose", "-f", composePath, "-f", overridePath, "down"], {
        cwd: configRoot,
        env: composeEnv
      });

      results.push({
        appName,
        status: "down"
      });
    }

    return {
      workspaceName,
      featureName,
      appsCount: results.length,
      results,
      agents: this.getAgentsInfo()
    };
  }

  async dockerPs(includeAll: boolean): Promise<DockerPsResult> {
    const args = includeAll
      ? ["ps", "-a", "--format", "{{json .}}"]
      : ["ps", "--format", "{{json .}}"];

    const { stdout } = await runCommand("docker", args, { env: process.env });
    const containers: Record<string, string>[] = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, string>);

    return {
      includeAll,
      count: containers.length,
      containers,
      agents: this.getAgentsInfo()
    };
  }

  async runAgent(
    containerId: string,
    prompt: string,
    threadId?: string,
    model?: string,
    agent?: string,
    providerOptions?: Record<string, unknown>
  ): Promise<AgentRunResult> {
    const provider = this.resolveProvider(agent);
    const effectiveThreadId = threadId || (await provider.createThread(containerId));

    log("INFO", "Running agent in app container", {
      containerId,
      threadId: effectiveThreadId,
      provider: provider.name,
      promptLength: prompt.length
    });

    const result = await provider.runChat(containerId, {
      threadId: effectiveThreadId,
      prompt,
      model,
      providerOptions
    });

    return {
      containerId,
      threadId: result.threadId,
      prompt,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }

  private resolveProvider(agent?: string): AgentProvider {
    if (!agent) return this.defaultProvider;
    const provider = this.providers.get(agent);
    if (!provider) {
      const available = [...this.providers.keys()].join(", ");
      throw new Error(`Unknown agent provider "${agent}". Available: ${available}`);
    }
    return provider;
  }

  private async getAppsRoot(workspaceName: string, featureName?: string): Promise<string> {
    const appsRoot = featureName
      ? path.join(this.config.workspacesRoot, workspaceName, "features", featureName, "apps")
      : path.join(this.config.workspacesRoot, workspaceName, "apps");
    const appsStat = await fs.stat(appsRoot).catch(() => null);
    if (!appsStat || !appsStat.isDirectory()) {
      throw new Error(`Apps directory not found: ${appsRoot}`);
    }
    return appsRoot;
  }

  private async listAppDirs(appsRoot: string): Promise<string[]> {
    const appEntries = await fs.readdir(appsRoot, { withFileTypes: true });
    return appEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  }

  private async readAppConfig(configPath: string): Promise<AppConfig> {
    const rawConfig = await fs.readFile(configPath, "utf8");
    return JSON.parse(rawConfig) as AppConfig;
  }

  private async exists(targetPath: string): Promise<boolean> {
    return fs
      .stat(targetPath)
      .then(() => true)
      .catch(() => false);
  }
}
