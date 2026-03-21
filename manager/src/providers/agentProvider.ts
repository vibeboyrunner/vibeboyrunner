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

export type AgentStreamChannel = "stdout" | "stderr";

export interface AgentUnifiedStreamEvent {
  type: "assistant_text" | "system_log";
  text: string;
  stream: AgentStreamChannel;
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
  runChatStream?(
    containerId: string,
    options: AgentChatOptions,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void
  ): Promise<AgentRunResult>;
  formatStreamChunk?(channel: AgentStreamChannel, chunk: string): AgentUnifiedStreamEvent[];
  getServicePaths(): AgentServicePaths;
  getAvailableModels(): string[];
}
