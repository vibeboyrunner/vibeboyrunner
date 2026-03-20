import { AgentProvider } from "./agentProvider";
import { CursorAgentProvider } from "./cursorProvider";

export function createAgentProvider(name: string, defaultModel: string): AgentProvider {
  switch (name) {
    case "cursor":
      return new CursorAgentProvider(defaultModel);
    default:
      throw new Error(`Unknown agent provider: ${name}`);
  }
}

export { AgentProvider, AgentChatOptions, AgentRunResult, AgentServicePaths } from "./agentProvider";
export { CursorAgentProvider } from "./cursorProvider";
