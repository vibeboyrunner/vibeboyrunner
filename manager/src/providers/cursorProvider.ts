import { AgentProvider, AgentChatOptions, AgentRunResult, AgentServicePaths } from "./agentProvider";
import { runCommand } from "../utils/process";

export class CursorAgentProvider implements AgentProvider {
  readonly name = "cursor";

  private readonly defaultForce = true;
  private readonly defaultSandbox = "disabled";

  constructor(private readonly defaultModel: string) {}

  buildInstallScript(): string {
    return [
      "if ! command -v agent >/dev/null 2>&1; then",
      "  if [ \"$(id -u)\" != \"0\" ]; then echo 'WARN: cannot install cursor agent as non-root'; else",
      "    if ! command -v curl >/dev/null 2>&1; then",
      "      if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends curl ca-certificates;",
      "      elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl ca-certificates; fi;",
      "    fi;",
      "    if command -v curl >/dev/null 2>&1; then",
      "      (curl -fsSL https://cursor.com/install | bash) || true;",
      "      ln -sf /root/.local/bin/agent /usr/local/bin/agent || true;",
      "      ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent || true;",
      "    fi;",
      "  fi;",
      "fi",
      "if command -v agent >/dev/null 2>&1 && ! agent --version >/dev/null 2>&1; then echo 'WARN: agent command exists but is not functional (likely libc mismatch)'; fi"
    ]
      .map((l) => l.trim())
      .join(" ");
  }

  buildConfigScript(servicesPath: string): string {
    return `ensure_symlink "${servicesPath}/cursor/default" "/root/.config/cursor"`;
  }

  async createThread(containerId: string): Promise<string> {
    const { stdout } = await runCommand("docker", ["exec", containerId, "agent", "--trust", "create-chat"], {
      env: process.env
    });

    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const uuidLike = lines.find((line) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)
    );
    const chatId = uuidLike || lines.at(-1);

    if (!chatId) {
      throw new Error("Failed to create agent chat thread: empty output");
    }

    return chatId;
  }

  async runChat(containerId: string, options: AgentChatOptions): Promise<AgentRunResult> {
    const model = (options.model || this.defaultModel || "").trim();
    const force =
      typeof options.providerOptions?.force === "boolean" ? options.providerOptions.force : this.defaultForce;
    const sandbox = (
      (typeof options.providerOptions?.sandbox === "string" ? options.providerOptions.sandbox : "") ||
      this.defaultSandbox
    ).trim();

    const agentArgs = ["exec", containerId, "agent", "--trust"];
    if (model) {
      agentArgs.push("--model", model);
    }
    if (force) {
      agentArgs.push("--force");
    }
    if (sandbox) {
      agentArgs.push("--sandbox", sandbox);
    }
    agentArgs.push("--resume", options.threadId, "chat", options.prompt);

    const { stdout, stderr } = await runCommand("docker", agentArgs, { env: process.env });

    return {
      threadId: options.threadId,
      stdout,
      stderr
    };
  }

  getServicePaths(): AgentServicePaths {
    return {
      configLinkSource: "cursor/default",
      configLinkTarget: "/root/.config/cursor",
      conversationSubdir: "cursor",
      dotDir: "dot-cursor",
      dotDirTarget: "/root/.cursor"
    };
  }
}
