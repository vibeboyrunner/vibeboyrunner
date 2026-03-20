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

    const result = await workspacePoolService.runAgent(
      containerId,
      prompt,
      threadId || undefined,
      model || undefined,
      Object.keys(providerOptions).length > 0 ? providerOptions : undefined
    );
    sendJson(res, 200, { ok: true, ...result });
    return { handled: true };
  }

  return { handled: false };
}
