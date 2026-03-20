import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { WorkspacePoolService } from "../../services/workspacePoolService";
import { ManagerConfig } from "../../types";

vi.mock("../../utils/process", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../utils/logger", () => ({
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

import { runCommand } from "../../utils/process";
const mockRunCommand = vi.mocked(runCommand);

function makeConfig(overrides: Partial<ManagerConfig> = {}): ManagerConfig {
  return {
    managerPort: 18080,
    managerHost: "0.0.0.0",
    workspacesRoot: "/tmp/test-workspaces",
    portPoolStart: 20000,
    portPoolEnd: 20099,
    dindHomePath: "/tmp/test-dind-home",
    appComposeServiceName: "app",
    agentProviders: ["cursor"],
    defaultAgentModel: "",
    ...overrides
  };
}

describe("WorkspacePoolService", () => {
  let tmpDir: string;
  let workspacesRoot: string;
  let dindHomePath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wps-"));
    workspacesRoot = path.join(tmpDir, "workspaces");
    dindHomePath = path.join(tmpDir, "dind-home");
    await fs.mkdir(workspacesRoot, { recursive: true });
    await fs.mkdir(dindHomePath, { recursive: true });

    mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function createAppWithConfig(
    appsRoot: string,
    appName: string,
    config: object = { bindings: { ports: { PORT: 20000 } } }
  ) {
    const vbrDir = path.join(appsRoot, appName, ".vibeboyrunner");
    await fs.mkdir(vbrDir, { recursive: true });
    await fs.writeFile(path.join(vbrDir, "config.json"), JSON.stringify(config));
    await fs.writeFile(
      path.join(vbrDir, "docker-compose.yml"),
      "services:\n  app:\n    image: node:22\n"
    );
  }

  describe("getAgentsInfo", () => {
    it("returns agents map keyed by provider name with models", () => {
      const config = makeConfig({ workspacesRoot, dindHomePath, defaultAgentModel: "gpt-4o" });
      const service = new WorkspacePoolService(config);
      const agents = service.getAgentsInfo();

      expect(agents.cursor).toBeDefined();
      expect(agents.cursor.defaultModel).toBe("gpt-4o");
      expect(agents.cursor.models).toBeInstanceOf(Array);
      expect(agents.cursor.models.length).toBeGreaterThan(0);
    });
  });

  describe("up", () => {
    it("throws when apps directory does not exist", async () => {
      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      await expect(service.up("nonexistent")).rejects.toThrow("Apps directory not found");
    });

    it("skips apps missing .vibeboyrunner/docker-compose.yml", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "apps");
      await fs.mkdir(path.join(appsRoot, "my-app"), { recursive: true });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.up("ws1");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe("skipped");
      expect(result.results[0].reason).toContain("missing");
      expect(result.agents.cursor).toBeDefined();
      expect(result.agents.cursor.models.length).toBeGreaterThan(0);
    });

    it("skips apps missing config.json", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "apps");
      const vbrDir = path.join(appsRoot, "my-app", ".vibeboyrunner");
      await fs.mkdir(vbrDir, { recursive: true });
      await fs.writeFile(path.join(vbrDir, "docker-compose.yml"), "services:\n  app:\n    image: node\n");

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.up("ws1");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe("skipped");
    });

    it("brings up a properly configured app", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "apps");
      await createAppWithConfig(appsRoot, "my-app", {
        bindings: {
          ports: { PORT: 20001 },
          envs: { NODE_ENV: "production" }
        }
      });

      mockRunCommand.mockResolvedValue({ stdout: "container123\n", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.up("ws1");

      expect(result.workspaceName).toBe("ws1");
      expect(result.appsCount).toBe(1);
      expect(result.results[0].status).toBe("up");
      expect(result.results[0].appName).toBe("my-app");
      expect(result.results[0].ports).toBeDefined();
      expect(result.results[0].envs).toEqual({ NODE_ENV: "production" });
    });

    it("handles multiple apps in workspace", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "apps");
      await createAppWithConfig(appsRoot, "app-a", { bindings: { ports: { PORT: 20010 } } });
      await createAppWithConfig(appsRoot, "app-b", { bindings: { ports: { PORT: 20011 } } });

      mockRunCommand.mockResolvedValue({ stdout: "container-id\n", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.up("ws1");

      expect(result.appsCount).toBe(2);
      expect(result.results.every((r) => r.status === "up")).toBe(true);
    });
  });

  describe("upFeature", () => {
    it("uses feature-scoped apps directory", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "features", "feat1", "apps");
      await createAppWithConfig(appsRoot, "my-app");

      mockRunCommand.mockResolvedValue({ stdout: "container123\n", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.upFeature("ws1", "feat1");

      expect(result.workspaceName).toBe("ws1");
      expect(result.featureName).toBe("feat1");
      expect(result.results[0].status).toBe("up");
    });
  });

  describe("down", () => {
    it("brings down a configured app", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "apps");
      await createAppWithConfig(appsRoot, "my-app");

      mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.down("ws1");

      expect(result.results).toHaveLength(1);
      expect(result.results[0].status).toBe("down");
    });

    it("skips apps without docker-compose.yml", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "apps");
      await fs.mkdir(path.join(appsRoot, "my-app"), { recursive: true });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.down("ws1");

      expect(result.results[0].status).toBe("skipped");
    });
  });

  describe("downFeature", () => {
    it("uses feature-scoped apps directory", async () => {
      const appsRoot = path.join(workspacesRoot, "ws1", "features", "feat1", "apps");
      await createAppWithConfig(appsRoot, "my-app");

      mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.downFeature("ws1", "feat1");

      expect(result.featureName).toBe("feat1");
      expect(result.results[0].status).toBe("down");
    });
  });

  describe("dockerPs", () => {
    it("parses JSON lines from docker ps", async () => {
      mockRunCommand.mockResolvedValue({
        stdout: '{"Names":"web","Status":"Up"}\n{"Names":"db","Status":"Up"}\n',
        stderr: ""
      });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.dockerPs(false);

      expect(result.includeAll).toBe(false);
      expect(result.count).toBe(2);
      expect(result.containers).toHaveLength(2);
      expect(result.containers[0].Names).toBe("web");
      expect(result.agents).toBeDefined();
      expect(result.agents.cursor).toBeDefined();
      expect(result.agents.cursor.models).toBeInstanceOf(Array);
      expect(result.agents.cursor.models.length).toBeGreaterThan(0);
    });

    it("passes -a flag when includeAll is true", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      await service.dockerPs(true);

      expect(mockRunCommand).toHaveBeenCalledWith(
        "docker",
        ["ps", "-a", "--format", "{{json .}}"],
        expect.any(Object)
      );
    });

    it("handles empty docker ps output", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "\n", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.dockerPs(false);

      expect(result.count).toBe(0);
      expect(result.containers).toEqual([]);
    });
  });

  describe("runAgent", () => {
    it("runs agent chat with provided params", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "Agent output\n", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.runAgent("ctr123", "do something", "thread-1", "gpt-4", undefined, {
        force: false,
        sandbox: "enabled"
      });

      expect(result.containerId).toBe("ctr123");
      expect(result.prompt).toBe("do something");
      expect(result.threadId).toBe("thread-1");
      expect(result.stdout).toContain("Agent output");
    });

    it("creates a new thread when threadId not provided", async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: "a1b2c3d4-e5f6-7890-abcd-ef1234567890\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "Agent done\n", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);
      const result = await service.runAgent("ctr123", "hello");

      expect(result.threadId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("delegates to agent provider with defaults", async () => {
      mockRunCommand
        .mockResolvedValueOnce({ stdout: "new-thread-id\n", stderr: "" })
        .mockResolvedValueOnce({ stdout: "done\n", stderr: "" });

      const config = makeConfig({
        workspacesRoot,
        dindHomePath,
        defaultAgentModel: "claude"
      });
      const service = new WorkspacePoolService(config);
      const result = await service.runAgent("ctr", "prompt");

      expect(result.containerId).toBe("ctr");
      expect(result.prompt).toBe("prompt");
      expect(result.stdout).toBe("done\n");
    });

    it("throws when thread creation returns empty output", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });

      const config = makeConfig({ workspacesRoot, dindHomePath });
      const service = new WorkspacePoolService(config);

      await expect(service.runAgent("ctr", "prompt")).rejects.toThrow("Failed to create agent chat thread");
    });
  });
});
