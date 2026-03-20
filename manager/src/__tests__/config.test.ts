import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getConfig } from "../config";

describe("getConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (
        key.startsWith("MANAGER_") ||
        key.startsWith("DIND_") ||
        key.startsWith("PORT_POOL_") ||
        key === "APP_COMPOSE_SERVICE_NAME" ||
        key === "AGENT_PROVIDERS"
      ) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns defaults when no env vars are set", () => {
    const config = getConfig();
    expect(config.managerPort).toBe(18080);
    expect(config.managerHost).toBe("0.0.0.0");
    expect(config.workspacesRoot).toBe("/workdir/workspaces");
    expect(config.portPoolStart).toBe(20000);
    expect(config.portPoolEnd).toBe(20499);
    expect(config.dindHomePath).toBe("/.vibeboyrunner");
    expect(config.appComposeServiceName).toBe("app");
    expect(config.agentProvider).toBe("cursor");
    expect(config.defaultAgentModel).toBe("");
  });

  it("reads MANAGER_PORT from env", () => {
    process.env.MANAGER_PORT = "9090";
    const config = getConfig();
    expect(config.managerPort).toBe(9090);
  });

  it("reads MANAGER_HOST from env", () => {
    process.env.MANAGER_HOST = "127.0.0.1";
    const config = getConfig();
    expect(config.managerHost).toBe("127.0.0.1");
  });

  it("prefers DIND_WORKSPACES_PATH over MANAGER_WORKSPACES_ROOT", () => {
    process.env.DIND_WORKSPACES_PATH = "/dind-path";
    process.env.MANAGER_WORKSPACES_ROOT = "/manager-path";
    const config = getConfig();
    expect(config.workspacesRoot).toBe("/dind-path");
  });

  it("falls back to MANAGER_WORKSPACES_ROOT when DIND_WORKSPACES_PATH is unset", () => {
    process.env.MANAGER_WORKSPACES_ROOT = "/manager-path";
    const config = getConfig();
    expect(config.workspacesRoot).toBe("/manager-path");
  });

  it("reads port pool bounds from env", () => {
    process.env.PORT_POOL_START = "30000";
    process.env.PORT_POOL_END = "30099";
    const config = getConfig();
    expect(config.portPoolStart).toBe(30000);
    expect(config.portPoolEnd).toBe(30099);
  });

  it("reads DIND_HOME_PATH from env", () => {
    process.env.DIND_HOME_PATH = "/custom/home";
    const config = getConfig();
    expect(config.dindHomePath).toBe("/custom/home");
  });

  it("reads APP_COMPOSE_SERVICE_NAME from env", () => {
    process.env.APP_COMPOSE_SERVICE_NAME = "web";
    const config = getConfig();
    expect(config.appComposeServiceName).toBe("web");
  });

  it("reads AGENT_PROVIDERS from env (first entry)", () => {
    process.env.AGENT_PROVIDERS = "claude,cursor";
    expect(getConfig().agentProvider).toBe("claude");
  });

  it("defaults agentProvider to cursor", () => {
    expect(getConfig().agentProvider).toBe("cursor");
  });

  it("reads agent model from env", () => {
    process.env.MANAGER_AGENT_MODEL = "gpt-4";
    expect(getConfig().defaultAgentModel).toBe("gpt-4");
  });

  it("trims agent model whitespace", () => {
    process.env.MANAGER_AGENT_MODEL = "  gpt-4  ";
    expect(getConfig().defaultAgentModel).toBe("gpt-4");
  });

  it("trims AGENT_PROVIDERS whitespace", () => {
    process.env.AGENT_PROVIDERS = "  cursor  ";
    expect(getConfig().agentProvider).toBe("cursor");
  });
});
