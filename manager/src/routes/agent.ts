import { IncomingMessage, ServerResponse } from "http";
import { WorkspacePoolService } from "../services/workspacePoolService";
import { parseJsonObject, sendJson } from "../utils/http";

interface HandlerResult {
  handled: boolean;
}

export async function handleAgentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  rawBody: string,
  workspacePoolService: WorkspacePoolService
): Promise<HandlerResult> {
  const method = req.method || "GET";

  if (method === "POST" && pathname === "/api/agent/run") {
    const body = parseJsonObject(rawBody);
    const containerId = String(body.containerId || "").trim();
    const prompt = String(body.prompt || "").trim();
    const threadId = String(body.threadId || "").trim();
    const model = String(body.model || "").trim();
    const agent = String(body.agent || "").trim();
    const stream = body.stream !== false;
    const streamFormat = body.streamFormat === "raw" ? "raw" : "unified";
    const streamEnvelope = body.streamEnvelope === "sse" ? "sse" : "plain";

    const providerOptions: Record<string, unknown> = {};
    if (typeof body.force === "boolean") {
      providerOptions.force = body.force;
    }
    if (typeof body.sandbox === "string" && body.sandbox.trim()) {
      providerOptions.sandbox = body.sandbox.trim();
    }

    if (!containerId) {
      sendJson(res, 400, { ok: false, error: "containerId is required" });
      return { handled: true };
    }

    if (!prompt) {
      sendJson(res, 400, { ok: false, error: "prompt is required" });
      return { handled: true };
    }

    const resolvedProviderOptions = Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
    if (!stream) {
      const result = await workspacePoolService.runAgent(
        containerId,
        prompt,
        threadId || undefined,
        model || undefined,
        agent || undefined,
        resolvedProviderOptions
      );
      sendJson(res, 200, { ok: true, ...result });
      return { handled: true };
    }

    if (streamEnvelope === "plain") {
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
    } else {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
    }

    const writeEvent = (event: string, data: unknown): void => {
      if (streamEnvelope === "plain") {
        return;
      }
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    if (streamEnvelope === "sse") {
      writeEvent("start", {
        ok: true,
        containerId,
        threadId: threadId || null,
        streamFormat,
        streamEnvelope
      });
    }

    try {
      const result = await workspacePoolService.runAgentStream(
        containerId,
        prompt,
        {
          onStdout: (chunk) => {
            if (streamFormat === "raw") {
              if (streamEnvelope === "plain") {
                res.write(chunk);
              } else {
                writeEvent("stdout", { chunk });
              }
            }
          },
          onStderr: (chunk) => {
            if (streamFormat === "raw") {
              if (streamEnvelope === "plain") {
                res.write(chunk);
              } else {
                writeEvent("stderr", { chunk });
              }
            }
          },
          onUnifiedEvent: (event) => {
            if (streamFormat === "unified") {
              if (streamEnvelope === "plain") {
                res.write(event.text);
              } else {
                writeEvent("message", event);
              }
            }
          }
        },
        threadId || undefined,
        model || undefined,
        agent || undefined,
        resolvedProviderOptions
      );

      if (streamEnvelope === "sse") {
        writeEvent("final", {
          ok: true,
          provider: result.provider,
          containerId: result.containerId,
          threadId: result.threadId,
          prompt: result.prompt,
          output: result.stdout,
          logs: result.stderr
        });
        writeEvent("result", { ok: true, ...result });
        writeEvent("done", { ok: true });
      }
    } catch (error) {
      if (streamEnvelope === "plain") {
        res.write(`\n[ERROR] ${String(error)}\n`);
      } else {
        writeEvent("error", { ok: false, error: String(error) });
      }
    } finally {
      res.end();
    }
    return { handled: true };
  }

  return { handled: false };
}
