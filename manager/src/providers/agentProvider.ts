export interface AgentChatOptions {
  threadId: string;
  prompt: string;
  model?: string;
  providerOptions?: Record<string, unknown>;
}

export interface AgentRunResult {
  threadId: string;
  stdout: string;
  stderr: string;
}

export interface AgentServicePaths {
  configLinkSource: string;
  configLinkTarget: string;
  conversationSubdir: string;
  dotDir: string;
  dotDirTarget: string;
}

export interface AgentProvider {
  readonly name: string;
  buildInstallScript(): string;
  buildConfigScript(servicesPath: string): string;
  createThread(containerId: string): Promise<string>;
  runChat(containerId: string, options: AgentChatOptions): Promise<AgentRunResult>;
  getServicePaths(): AgentServicePaths;
  getAvailableModels(): string[];
}
