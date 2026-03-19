export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface ManagerConfig {
  managerPort: number;
  managerHost: string;
  workspacesRoot: string;
  portPoolStart: number;
  portPoolEnd: number;
  dindHomePath: string;
  appComposeServiceName: string;
  defaultAgentModel: string;
  defaultAgentForce: boolean;
  defaultAgentSandbox: string;
}

export interface AppConfig {
  bindings?: {
    ports?: Record<string, string | number>;
    envs?: Record<string, string | number>;
  };
}

export interface AppResult {
  appName: string;
  status: "up" | "down" | "skipped";
  reason?: string;
  ports?: Record<string, string>;
  envs?: Record<string, string>;
  runtimeWarnings?: string[];
}
