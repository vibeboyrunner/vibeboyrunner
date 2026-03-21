import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import http from "http";
import fsSync from "fs";
import fsPromises from "fs/promises";
import pathMod from "path";
import os from "os";

vi.mock("../utils/process", () => ({
  runCommand: vi.fn(),
  runCommandStreaming: vi.fn()
}));

vi.mock("../utils/logger", () => ({
  log: vi.fn()
}));

vi.mock("net", () => {
  function createMockServer() {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    return {
      once(event: string, cb: (...args: unknown[]) => void) { listeners[event] = cb; return this; },
      listen() { if (listeners.listening) listeners.listening(); },
      close(cb: () => void) { cb(); }
    };
  }
  const mock = { createServer: vi.fn(() => createMockServer()) };
  return { default: mock, ...mock };
});

import { runCommand, runCommandStreaming } from "../utils/process";
const mockRunCommand = vi.mocked(runCommand);
const mockRunCommandStreaming = vi.mocked(runCommandStreaming);

function request(
  server: http.Server,
  method: string,
  path: string,
  body?: object
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 0, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function requestSse(
  server: http.Server,
  path: string,
  body?: object
): Promise<{ status: number; raw: string }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as { port: number };
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method: "POST",
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {}
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk.toString()));
        res.on("end", () => {
          resolve({ status: res.statusCode || 0, raw: data });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe("Manager HTTP Server - Integration", () => {
  let server: http.Server;
  let tmpBase: string;
  let workspacesDir: string;
  let dindHomeDir: string;

  beforeAll(async () => {
    tmpBase = await fsPromises.mkdtemp(pathMod.join(os.tmpdir(), "srv-test-"));
    workspacesDir = pathMod.join(tmpBase, "workspaces");
    dindHomeDir = pathMod.join(tmpBase, "dind-home");
    await fsPromises.mkdir(workspacesDir, { recursive: true });
    await fsPromises.mkdir(dindHomeDir, { recursive: true });

    process.env.MANAGER_PORT = "0";
    process.env.MANAGER_HOST = "127.0.0.1";
    process.env.DIND_WORKSPACES_PATH = workspacesDir;
    process.env.DIND_HOME_PATH = dindHomeDir;
    process.env.PORT_POOL_START = "20000";
    process.env.PORT_POOL_END = "20099";

    mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });
    mockRunCommandStreaming.mockImplementation(async (_command, _args, options) => {
      options?.onStdout?.("");
      return { stdout: "", stderr: "" };
    });

    const { getConfig } = await import("../config");
    const { WorkspacePoolService } = await import("../services/workspacePoolService");
    const { handlePoolRoutes } = await import("../routes/pools");
    const { handleAgentRoutes } = await import("../routes/agent");
    const { handleWorkspaceRoutes } = await import("../routes/workspaces");
    const { readBody, sendJson } = await import("../utils/http");

    const config = getConfig();
    const workspacePoolService = new WorkspacePoolService(config);

    server = http.createServer(async (req, res) => {
      const method = req.method || "GET";
      const parsedUrl = new URL(req.url || "/", "http://localhost");

      try {
        const rawBody = await readBody(req);

        if (method === "GET" && parsedUrl.pathname === "/health") {
          sendJson(res, 200, {
            ok: true,
            service: "manager",
            workspacesRoot: config.workspacesRoot,
            portPool: { start: config.portPoolStart, end: config.portPoolEnd }
          });
          return;
        }

        const poolResult = await handlePoolRoutes(req, res, parsedUrl, workspacePoolService);
        if (poolResult.handled) return;

        const agentResult = await handleAgentRoutes(req, res, parsedUrl.pathname, rawBody, workspacePoolService);
        if (agentResult.handled) return;

        const wsResult = await handleWorkspaceRoutes(req, res, parsedUrl.pathname, workspacePoolService);
        if (wsResult.handled) return;

        sendJson(res, 404, { ok: false, error: "Not found" });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: String(error) });
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fsPromises.rm(tmpBase, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });
    mockRunCommandStreaming.mockImplementation(async (_command, _args, options) => {
      options?.onStdout?.("");
      return { stdout: "", stderr: "" };
    });
  });

  describe("GET /health", () => {
    it("returns ok with config details", async () => {
      const res = await request(server, "GET", "/health");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.service).toBe("manager");
      expect(res.body.workspacesRoot).toBe(workspacesDir);
      expect(res.body.portPool).toEqual({ start: 20000, end: 20099 });
    });
  });

  describe("GET /api/pools/ps", () => {
    it("returns containers list with agent info", async () => {
      mockRunCommand.mockResolvedValue({
        stdout: '{"Names":"web","Status":"Up 2h"}\n',
        stderr: ""
      });

      const res = await request(server, "GET", "/api/pools/ps");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.count).toBe(1);
      expect(res.body.containers[0].Names).toBe("web");
      expect(res.body.agents).toBeDefined();
      expect(res.body.agents.cursor).toBeDefined();
      expect(res.body.agents.cursor.models).toBeInstanceOf(Array);
      expect(res.body.agents.cursor.models.length).toBeGreaterThan(0);
    });

    it("passes all=true query parameter", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });

      const res = await request(server, "GET", "/api/pools/ps?all=true");
      expect(res.status).toBe(200);
      expect(res.body.includeAll).toBe(true);
    });
  });

  describe("POST /api/agent/run", () => {
    it("returns 400 when containerId is missing", async () => {
      const res = await request(server, "POST", "/api/agent/run", { prompt: "hello" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("containerId is required");
    });

    it("returns 400 when prompt is missing", async () => {
      const res = await request(server, "POST", "/api/agent/run", { containerId: "abc" });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("prompt is required");
    });

    it("runs agent with valid params", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "agent-output\n", stderr: "" });

      const res = await request(server, "POST", "/api/agent/run", {
        containerId: "ctr123",
        prompt: "do something",
        threadId: "t1",
        stream: false
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.provider).toBe("cursor");
      expect(res.body.containerId).toBe("ctr123");
      expect(res.body.prompt).toBe("do something");
    });

    it("streams agent output over SSE in unified format by default", async () => {
      mockRunCommandStreaming.mockImplementation(async (_command, _args, options) => {
        options?.onStdout?.(
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"streamed-output\\n"}]},"timestamp_ms":1}\n'
        );
        options?.onStdout?.(
          '{"type":"result","subtype":"success","result":"streamed-output\\n"}\n'
        );
        return { stdout: "", stderr: "" };
      });

      const res = await requestSse(server, "/api/agent/run", {
        containerId: "ctr123",
        prompt: "do something",
        threadId: "t1",
        streamEnvelope: "sse"
      });

      expect(res.status).toBe(200);
      expect(res.raw).toContain("event: start");
      expect(res.raw).toContain('"streamFormat":"unified"');
      expect(res.raw).toContain('"streamEnvelope":"sse"');
      expect(res.raw).toContain("event: message");
      expect(res.raw).toContain("streamed-output");
      expect(res.raw).toContain("event: final");
      expect(res.raw).toContain("event: result");
      expect(res.raw).toContain("event: done");
    });

    it("uses plain unified streaming as default when stream fields are omitted", async () => {
      mockRunCommandStreaming.mockImplementation(async (_command, _args, options) => {
        options?.onStdout?.(
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"default-stream\\n"}]},"timestamp_ms":1}\n'
        );
        options?.onStdout?.(
          '{"type":"result","subtype":"success","result":"default-stream\\n"}\n'
        );
        return { stdout: "", stderr: "" };
      });

      const res = await requestSse(server, "/api/agent/run", {
        containerId: "ctr123",
        prompt: "do something",
        threadId: "t1"
      });

      expect(res.status).toBe(200);
      expect(res.raw).toContain("default-stream");
      expect(res.raw).not.toContain("event:");
      expect(res.raw).not.toContain("data:");
    });

    it("supports raw stream format for debugging", async () => {
      mockRunCommandStreaming.mockImplementation(async (_command, _args, options) => {
        options?.onStdout?.(
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"raw-stream\\n"}]},"timestamp_ms":1}\n'
        );
        options?.onStdout?.(
          '{"type":"result","subtype":"success","result":"raw-stream\\n"}\n'
        );
        return { stdout: "", stderr: "" };
      });

      const res = await requestSse(server, "/api/agent/run", {
        containerId: "ctr123",
        prompt: "do something",
        threadId: "t1",
        stream: true,
        streamFormat: "raw",
        streamEnvelope: "sse"
      });

      expect(res.status).toBe(200);
      expect(res.raw).toContain('"streamFormat":"raw"');
      expect(res.raw).toContain("event: stdout");
      expect(res.raw).toContain("raw-stream");
      expect(res.raw).toContain("event: final");
    });

    it("streams plain text without SSE envelope when requested", async () => {
      mockRunCommandStreaming.mockImplementation(async (_command, _args, options) => {
        options?.onStdout?.(
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"TEST_OK\\n"}]},"timestamp_ms":1}\n'
        );
        options?.onStdout?.(
          '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"/app\\n"}]},"timestamp_ms":2}\n'
        );
        options?.onStdout?.(
          '{"type":"result","subtype":"success","result":"TEST_OK\\n/app\\n"}\n'
        );
        return { stdout: "", stderr: "" };
      });

      const res = await requestSse(server, "/api/agent/run", {
        containerId: "ctr123",
        prompt: "do something",
        threadId: "t1",
        stream: true,
        streamFormat: "unified",
        streamEnvelope: "plain"
      });

      expect(res.status).toBe(200);
      expect(res.raw).toContain("TEST_OK");
      expect(res.raw).toContain("/app");
      expect(res.raw).not.toContain("event:");
      expect(res.raw).not.toContain("data:");
    });
  });

  describe("POST /api/workspaces/:workspace/dev-pool/up", () => {
    it("returns 500 when workspace does not exist", async () => {
      const res = await request(server, "POST", "/api/workspaces/nonexistent/dev-pool/up");
      expect(res.status).toBe(500);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain("Apps directory not found");
    });

    it("brings up workspace pool with valid apps", async () => {
      const wsApps = pathMod.join(workspacesDir, "test-ws/apps/my-app/.vibeboyrunner");
      await fsPromises.mkdir(wsApps, { recursive: true });
      await fsPromises.writeFile(
        pathMod.join(wsApps, "config.json"),
        JSON.stringify({ bindings: { ports: { PORT: 20001 } } })
      );
      await fsPromises.writeFile(
        pathMod.join(wsApps, "docker-compose.yml"),
        "services:\n  app:\n    image: node\n"
      );

      mockRunCommand.mockResolvedValue({ stdout: "container-id\n", stderr: "" });

      const res = await request(server, "POST", "/api/workspaces/test-ws/dev-pool/up");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.workspaceName).toBe("test-ws");
      expect(res.body.results).toHaveLength(1);

      await fsPromises.rm(pathMod.join(workspacesDir, "test-ws"), { recursive: true, force: true });
    });
  });

  describe("POST /api/workspaces/:workspace/dev-pool/down", () => {
    it("returns 500 for nonexistent workspace", async () => {
      const res = await request(server, "POST", "/api/workspaces/nonexistent/dev-pool/down");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/workspaces/:workspace/features/:feature/dev-pool/up", () => {
    it("returns 500 for nonexistent feature path", async () => {
      const res = await request(server, "POST", "/api/workspaces/ws/features/feat/dev-pool/up");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/workspaces/:workspace/features/:feature/dev-pool/down", () => {
    it("returns 500 for nonexistent feature path", async () => {
      const res = await request(server, "POST", "/api/workspaces/ws/features/feat/dev-pool/down");
      expect(res.status).toBe(500);
    });
  });

  describe("unknown routes", () => {
    it("returns 404 for GET on unknown path", async () => {
      const res = await request(server, "GET", "/unknown");
      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toBe("Not found");
    });

    it("returns 404 for POST on unknown path", async () => {
      const res = await request(server, "POST", "/api/unknown");
      expect(res.status).toBe(404);
      expect(res.body.ok).toBe(false);
    });
  });
});
