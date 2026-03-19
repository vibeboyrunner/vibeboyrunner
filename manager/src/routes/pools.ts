import { IncomingMessage, ServerResponse } from "http";
import { sendJson } from "../utils/http";
import { WorkspacePoolService } from "../services/workspacePoolService";

interface HandlerResult {
  handled: boolean;
}

export async function handlePoolRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  workspacePoolService: WorkspacePoolService
): Promise<HandlerResult> {
  const method = req.method || "GET";

  if (method === "GET" && url.pathname === "/api/pools/ps") {
    const includeAll = url.searchParams.get("all") === "true";
    const result = await workspacePoolService.dockerPs(includeAll);
    sendJson(res, 200, { ok: true, ...result });
    return { handled: true };
  }

  return { handled: false };
}
