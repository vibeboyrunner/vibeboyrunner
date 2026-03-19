import http from "http";
import { getConfig } from "./config";
import { handleAgentRoutes } from "./routes/agent";
import { handlePoolRoutes } from "./routes/pools";
import { handleWorkspaceRoutes } from "./routes/workspaces";
import { WorkspacePoolService } from "./services/workspacePoolService";
import { readBody, sendJson } from "./utils/http";
import { log } from "./utils/logger";

const config = getConfig();
const workspacePoolService = new WorkspacePoolService(config);

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  const method = req.method || "GET";
  const parsedUrl = new URL(req.url || "/", "http://localhost");

  log("INFO", "HTTP request started", {
    method,
    path: parsedUrl.pathname,
    remote: req.socket.remoteAddress
  });

  try {
    const rawBody = await readBody(req);

    if (method === "GET" && parsedUrl.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "manager",
        workspacesRoot: config.workspacesRoot,
        portPool: {
          start: config.portPoolStart,
          end: config.portPoolEnd
        }
      });
      return;
    }

    const poolRouteResult = await handlePoolRoutes(req, res, parsedUrl, workspacePoolService);
    if (poolRouteResult.handled) {
      return;
    }

    const agentRouteResult = await handleAgentRoutes(req, res, parsedUrl.pathname, rawBody, workspacePoolService);
    if (agentRouteResult.handled) {
      return;
    }

    const workspaceRouteResult = await handleWorkspaceRoutes(req, res, parsedUrl.pathname, workspacePoolService);
    if (workspaceRouteResult.handled) {
      return;
    }

    sendJson(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    log("ERROR", "HTTP request failed", {
      method,
      path: parsedUrl.pathname,
      error: String(error)
    });
    sendJson(res, 500, { ok: false, error: String(error) });
  } finally {
    log("INFO", "HTTP request finished", {
      method,
      path: parsedUrl.pathname,
      durationMs: Date.now() - start
    });
  }
});

server.listen(config.managerPort, config.managerHost, () => {
  log("INFO", "Manager service started", {
    host: config.managerHost,
    port: config.managerPort,
    workspacesRoot: config.workspacesRoot,
    portPoolStart: config.portPoolStart,
    portPoolEnd: config.portPoolEnd
  });
});
