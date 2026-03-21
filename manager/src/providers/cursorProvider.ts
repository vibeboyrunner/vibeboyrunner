import {
  AgentProvider,
  AgentChatOptions,
  AgentRunResult,
  AgentServicePaths,
  AgentStreamChannel,
  AgentUnifiedStreamEvent
} from "./agentProvider";
import { runCommand, runCommandStreaming } from "../utils/process";

export class CursorAgentProvider implements AgentProvider {
  readonly name = "cursor";

  private readonly defaultForce = true;
  private readonly defaultSandbox = "disabled";

  constructor(private readonly defaultModel: string) {}

  buildInstallScript(): string {
    return [
      "if ! command -v agent >/dev/null 2>&1; then if [ \"$(id -u)\" != \"0\" ]; then echo 'WARN: cannot install cursor agent as non-root'; else if ! command -v curl >/dev/null 2>&1; then if command -v apt-get >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends curl ca-certificates || true; elif command -v apk >/dev/null 2>&1; then apk add --no-cache curl ca-certificates || true; fi; fi; if command -v curl >/dev/null 2>&1; then (curl -fsSL https://cursor.com/install | bash) || true; ln -sf /root/.local/bin/agent /usr/local/bin/agent || true; ln -sf /root/.local/bin/cursor-agent /usr/local/bin/cursor-agent || true; fi; fi; fi",
      "if ! command -v agent >/dev/null 2>&1; then echo 'WARN: cursor agent installation failed — agent command not available'; fi"
    ].join("; ");
  }

  buildConfigScript(servicesPath: string): string {
    return `ensure_symlink "${servicesPath}/cursor/default" "/root/.config/cursor"`;
  }

  async createThread(containerId: string): Promise<string> {
    const { stdout } = await runCommand(
      "docker",
      ["exec", containerId, "agent", "--trust", "create-chat"],
      { env: process.env, timeoutMs: 30_000 }
    );

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

    const agentArgs = ["exec", containerId, "agent", "--trust", "--print"];
    if (model) {
      agentArgs.push("--model", model);
    }
    if (force) {
      agentArgs.push("--force");
    }
    if (sandbox) {
      agentArgs.push("--sandbox", sandbox);
    }
    agentArgs.push("--resume", options.threadId, options.prompt);

    const { stdout, stderr } = await runCommand("docker", agentArgs, {
      env: process.env,
      timeoutMs: 300_000
    });

    return {
      threadId: options.threadId,
      stdout,
      stderr
    };
  }

  async runChatStream(
    containerId: string,
    options: AgentChatOptions,
    onStdout: (chunk: string) => void,
    onStderr: (chunk: string) => void
  ): Promise<AgentRunResult> {
    const model = (options.model || this.defaultModel || "").trim();
    const force =
      typeof options.providerOptions?.force === "boolean" ? options.providerOptions.force : this.defaultForce;
    const sandbox = (
      (typeof options.providerOptions?.sandbox === "string" ? options.providerOptions.sandbox : "") ||
      this.defaultSandbox
    ).trim();

    const agentArgs = [
      "exec",
      containerId,
      "agent",
      "--trust",
      "--print",
      "--output-format",
      "stream-json",
      "--stream-partial-output"
    ];
    if (model) {
      agentArgs.push("--model", model);
    }
    if (force) {
      agentArgs.push("--force");
    }
    if (sandbox) {
      agentArgs.push("--sandbox", sandbox);
    }
    agentArgs.push("--resume", options.threadId, options.prompt);

    let stdoutBuffer = "";
    let streamedText = "";
    let resultText = "";

    const flushJsonLines = (): void => {
      let newlineIdx = stdoutBuffer.indexOf("\n");
      while (newlineIdx !== -1) {
        const line = stdoutBuffer.slice(0, newlineIdx).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1);
        if (line.length > 0) {
          this.handleStreamJsonLine(
            line,
            (text) => {
              streamedText += text;
              onStdout(text);
            },
            (text) => {
              onStderr(text);
            },
            (text) => {
              resultText = text;
            }
          );
        }
        newlineIdx = stdoutBuffer.indexOf("\n");
      }
    };

    const { stderr } = await runCommandStreaming("docker", agentArgs, {
      env: process.env,
      timeoutMs: 300_000,
      onStdout: (chunk) => {
        stdoutBuffer += chunk;
        flushJsonLines();
      },
      onStderr
    });

    const trailing = stdoutBuffer.trim();
    if (trailing.length > 0) {
      this.handleStreamJsonLine(
        trailing,
        (text) => {
          streamedText += text;
          onStdout(text);
        },
        (text) => {
          onStderr(text);
        },
        (text) => {
          resultText = text;
        }
      );
    }

    const finalStdout = streamedText || resultText;

    return {
      threadId: options.threadId,
      stdout: finalStdout,
      stderr
    };
  }

  private handleStreamJsonLine(
    line: string,
    onAssistantText: (text: string) => void,
    onSystemLog: (text: string) => void,
    onResultText: (text: string) => void
  ): void {
    let parsed: any;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (parsed?.type === "assistant") {
      const content = Array.isArray(parsed?.message?.content) ? parsed.message.content : [];
      const text = content
        .filter((item: any) => item?.type === "text" && typeof item?.text === "string")
        .map((item: any) => String(item.text))
        .join("");
      if (!text) return;

      const isPartialDelta = typeof parsed?.timestamp_ms === "number";
      if (isPartialDelta) {
        onAssistantText(text);
      }
      return;
    }

    if (parsed?.type === "result" && parsed?.subtype === "success" && typeof parsed?.result === "string") {
      onResultText(parsed.result);
      return;
    }

    if (parsed?.type === "tool_call") {
      const subtype = String(parsed?.subtype || "");
      const toolName = this.getToolCallName(parsed?.tool_call);
      if (subtype === "started") {
        onSystemLog(`[tool:start] ${toolName}\n`);
        return;
      }
      if (subtype === "completed") {
        const status = this.getToolCallStatus(parsed?.tool_call);
        onSystemLog(`[tool:done] ${toolName} (${status})\n`);
        return;
      }
    }

    if (parsed?.type === "thinking" && parsed?.subtype === "delta" && typeof parsed?.text === "string") {
      // Keep streaming useful but lightweight: expose only short thinking snippets.
      const text = parsed.text.trim();
      if (text.length > 0) {
        onSystemLog(`[thinking] ${text}\n`);
      }
    }
  }

  private getToolCallName(toolCall: any): string {
    if (!toolCall || typeof toolCall !== "object") return "tool";
    if (toolCall.shellToolCall) return "shell";
    if (toolCall.readToolCall) return "read";
    if (toolCall.globToolCall) return "glob";
    if (toolCall.rgToolCall) return "rg";
    if (toolCall.editToolCall) return "edit";
    if (toolCall.applyPatchToolCall) return "apply_patch";
    return "tool";
  }

  private getToolCallStatus(toolCall: any): string {
    if (!toolCall || typeof toolCall !== "object") return "unknown";
    const candidates = [
      toolCall.shellToolCall?.result,
      toolCall.readToolCall?.result,
      toolCall.globToolCall?.result,
      toolCall.rgToolCall?.result,
      toolCall.editToolCall?.result,
      toolCall.applyPatchToolCall?.result
    ];
    for (const result of candidates) {
      if (!result || typeof result !== "object") continue;
      if (result.success) return "success";
      if (result.rejected) return "rejected";
      if (result.error) return "error";
      if (result.timeout) return "timeout";
    }
    return "unknown";
  }

  formatStreamChunk(channel: AgentStreamChannel, chunk: string): AgentUnifiedStreamEvent[] {
    if (!chunk) return [];
    if (channel === "stdout") {
      return [{ type: "assistant_text", text: chunk, stream: "stdout" }];
    }
    return [{ type: "system_log", text: chunk, stream: "stderr" }];
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

  getAvailableModels(): string[] {
    return [
      "composer-2-fast",
      "composer-2",
      "composer-1.5",
      "gpt-5.3-codex-low",
      "gpt-5.3-codex-low-fast",
      "gpt-5.3-codex",
      "gpt-5.3-codex-fast",
      "gpt-5.3-codex-high",
      "gpt-5.3-codex-high-fast",
      "gpt-5.3-codex-xhigh",
      "gpt-5.3-codex-xhigh-fast",
      "gpt-5.2",
      "gpt-5.3-codex-spark-preview-low",
      "gpt-5.3-codex-spark-preview",
      "gpt-5.3-codex-spark-preview-high",
      "gpt-5.3-codex-spark-preview-xhigh",
      "gpt-5.2-codex-low",
      "gpt-5.2-codex-low-fast",
      "gpt-5.2-codex",
      "gpt-5.2-codex-fast",
      "gpt-5.2-codex-high",
      "gpt-5.2-codex-high-fast",
      "gpt-5.2-codex-xhigh",
      "gpt-5.2-codex-xhigh-fast",
      "gpt-5.1-codex-max-low",
      "gpt-5.1-codex-max-low-fast",
      "gpt-5.1-codex-max-medium",
      "gpt-5.1-codex-max-medium-fast",
      "gpt-5.1-codex-max-high",
      "gpt-5.1-codex-max-high-fast",
      "gpt-5.1-codex-max-xhigh",
      "gpt-5.1-codex-max-xhigh-fast",
      "gpt-5.4-high",
      "gpt-5.4-high-fast",
      "gpt-5.4-xhigh-fast",
      "claude-4.6-opus-high-thinking",
      "gpt-5.4-low",
      "gpt-5.4-medium",
      "gpt-5.4-medium-fast",
      "gpt-5.4-xhigh",
      "claude-4.6-sonnet-medium",
      "claude-4.6-sonnet-medium-thinking",
      "claude-4.6-opus-high",
      "claude-4.6-opus-max",
      "claude-4.6-opus-max-thinking",
      "claude-4.5-opus-high",
      "claude-4.5-opus-high-thinking",
      "gpt-5.2-low",
      "gpt-5.2-low-fast",
      "gpt-5.2-fast",
      "gpt-5.2-high",
      "gpt-5.2-high-fast",
      "gpt-5.2-xhigh",
      "gpt-5.2-xhigh-fast",
      "gemini-3.1-pro",
      "gpt-5.4-mini-none",
      "gpt-5.4-mini-low",
      "gpt-5.4-mini-medium",
      "gpt-5.4-mini-high",
      "gpt-5.4-mini-xhigh",
      "gpt-5.4-nano-none",
      "gpt-5.4-nano-low",
      "gpt-5.4-nano-medium",
      "gpt-5.4-nano-high",
      "gpt-5.4-nano-xhigh",
      "grok-4-20",
      "grok-4-20-thinking",
      "claude-4.5-sonnet",
      "claude-4.5-sonnet-thinking",
      "gpt-5.1-low",
      "gpt-5.1",
      "gpt-5.1-high",
      "gemini-3-pro",
      "gemini-3-flash",
      "gpt-5.1-codex-mini-low",
      "gpt-5.1-codex-mini",
      "gpt-5.1-codex-mini-high",
      "claude-4-sonnet",
      "claude-4-sonnet-1m",
      "claude-4-sonnet-thinking",
      "claude-4-sonnet-1m-thinking",
      "gpt-5-mini",
      "kimi-k2.5"
    ];
  }
}
