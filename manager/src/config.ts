import { ManagerConfig } from "./types";

export function getConfig(): ManagerConfig {
  return {
    managerPort: Number.parseInt(process.env.MANAGER_PORT || "18080", 10),
    managerHost: process.env.MANAGER_HOST || "0.0.0.0",
    workspacesRoot:
      process.env.DIND_WORKSPACES_PATH || process.env.MANAGER_WORKSPACES_ROOT || "/workdir/workspaces",
    portPoolStart: Number.parseInt(process.env.PORT_POOL_START || "20000", 10),
    portPoolEnd: Number.parseInt(process.env.PORT_POOL_END || "20499", 10),
    dindHomePath: process.env.DIND_HOME_PATH || "/.vibeboyrunner",
    appComposeServiceName: process.env.APP_COMPOSE_SERVICE_NAME || "app",
    agentProvider: (process.env.AGENT_PROVIDERS || "cursor").split(",")[0].trim(),
    defaultAgentModel: (process.env.MANAGER_AGENT_MODEL || "").trim()
  };
}
