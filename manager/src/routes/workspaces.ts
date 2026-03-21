import { IncomingMessage, ServerResponse } from "http";
import { sendJson } from "../utils/http";
import { WorkspacePoolService } from "../services/workspacePoolService";

interface HandlerResult {
  handled: boolean;
}

export async function handleWorkspaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  workspacePoolService: WorkspacePoolService
): Promise<HandlerResult> {
  const method = req.method || "GET";

  const featureUpMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/features\/([^/]+)\/dev-pool\/up$/);
  if (method === "POST" && featureUpMatch) {
    const workspaceName = decodeURIComponent(featureUpMatch[1]);
    const featureName = decodeURIComponent(featureUpMatch[2]);
    const result = await workspacePoolService.upFeature(workspaceName, featureName);
    sendJson(res, 200, { ok: true, ...result });
    return { handled: true };
  }

  const featureDownMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/features\/([^/]+)\/dev-pool\/down$/);
  if (method === "POST" && featureDownMatch) {
    const workspaceName = decodeURIComponent(featureDownMatch[1]);
    const featureName = decodeURIComponent(featureDownMatch[2]);
    const result = await workspacePoolService.downFeature(workspaceName, featureName);
    sendJson(res, 200, { ok: true, ...result });
    return { handled: true };
  }

  const upMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/dev-pool\/up$/);
  if (method === "POST" && upMatch) {
    const workspaceName = decodeURIComponent(upMatch[1]);
    const result = await workspacePoolService.up(workspaceName);
    sendJson(res, 200, { ok: true, ...result });
    return { handled: true };
  }

  const downMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/dev-pool\/down$/);
  if (method === "POST" && downMatch) {
    const workspaceName = decodeURIComponent(downMatch[1]);
    const result = await workspacePoolService.down(workspaceName);
    sendJson(res, 200, { ok: true, ...result });
    return { handled: true };
  }

  return { handled: false };
}
