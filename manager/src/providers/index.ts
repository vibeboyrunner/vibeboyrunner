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

export function createAllAgentProviders(
  names: string[],
  defaultModel: string
): Map<string, AgentProvider> {
  const providers = new Map<string, AgentProvider>();
  for (const name of names) {
    providers.set(name, createAgentProvider(name, defaultModel));
  }
  if (providers.size === 0) {
    throw new Error("At least one agent provider must be configured");
  }
  return providers;
}

export {
  AgentProvider,
  AgentChatOptions,
  AgentRunResult,
  AgentServicePaths,
  AgentStreamChannel,
  AgentUnifiedStreamEvent
} from "./agentProvider";
export { CursorAgentProvider } from "./cursorProvider";
