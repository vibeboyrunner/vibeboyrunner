import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { RuntimeInjector } from "../../services/runtimeInjector";
import { ManagerConfig } from "../../types";

vi.mock("../../utils/process", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../utils/logger", () => ({
  log: vi.fn()
}));

import { runCommand } from "../../utils/process";
const mockRunCommand = vi.mocked(runCommand);

function makeConfig(overrides: Partial<ManagerConfig> = {}): ManagerConfig {
  return {
    managerPort: 18080,
    managerHost: "0.0.0.0",
    workspacesRoot: "/workdir/workspaces",
    portPoolStart: 20000,
    portPoolEnd: 20499,
    dindHomePath: "/.vibeboyrunner",
    appComposeServiceName: "app",
    defaultAgentModel: "",
    defaultAgentForce: true,
    defaultAgentSandbox: "disabled",
    ...overrides
  };
}

describe("RuntimeInjector", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "runtimeInjector-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("ensureSharedServicesMountOverride", () => {
    it("writes override YAML for workspace-level pool", async () => {
      const config = makeConfig({ dindHomePath: tmpDir, appComposeServiceName: "app" });
      const injector = new RuntimeInjector(config);
      const configRoot = path.join(tmpDir, "configRoot");
      await fs.mkdir(configRoot, { recursive: true });

      const overridePath = await injector.ensureSharedServicesMountOverride(
        configRoot,
        "my-workspace",
        "my-app"
      );

      expect(overridePath).toBe(path.join(configRoot, ".vbr-manager.override.yml"));
      const content = await fs.readFile(overridePath, "utf8");
      expect(content).toContain("services:");
      expect(content).toContain("app:");
      expect(content).toContain("volumes:");
      expect(content).toContain(`${tmpDir}/services:${tmpDir}/services`);
    });

    it("writes override YAML for feature-level pool", async () => {
      const config = makeConfig({ dindHomePath: tmpDir, appComposeServiceName: "app" });
      const injector = new RuntimeInjector(config);
      const configRoot = path.join(tmpDir, "configRoot");
      await fs.mkdir(configRoot, { recursive: true });

      await injector.ensureSharedServicesMountOverride(
        configRoot,
        "my-workspace",
        "my-app",
        "my-feature"
      );

      const overridePath = path.join(configRoot, ".vbr-manager.override.yml");
      const content = await fs.readFile(overridePath, "utf8");
      expect(content).toContain("features");
      expect(content).toContain("my-feature");
    });

    it("creates the worker dot-cursor directory", async () => {
      const config = makeConfig({ dindHomePath: tmpDir });
      const injector = new RuntimeInjector(config);
      const configRoot = path.join(tmpDir, "configRoot");
      await fs.mkdir(configRoot, { recursive: true });

      await injector.ensureSharedServicesMountOverride(configRoot, "ws", "app");

      const dotCursorPath = path.join(
        tmpDir,
        "state/conversations/pools/ws/apps/app/worker/cursor/dot-cursor"
      );
      const stat = await fs.stat(dotCursorPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it("adds override file to .gitignore", async () => {
      const config = makeConfig({ dindHomePath: tmpDir });
      const injector = new RuntimeInjector(config);
      const configRoot = path.join(tmpDir, "configRoot");
      await fs.mkdir(configRoot, { recursive: true });

      await injector.ensureSharedServicesMountOverride(configRoot, "ws", "app");

      const gitignore = await fs.readFile(path.join(configRoot, ".gitignore"), "utf8");
      expect(gitignore).toContain(".vbr-manager.override.yml");
    });

    it("does not duplicate .gitignore entry on repeated calls", async () => {
      const config = makeConfig({ dindHomePath: tmpDir });
      const injector = new RuntimeInjector(config);
      const configRoot = path.join(tmpDir, "configRoot");
      await fs.mkdir(configRoot, { recursive: true });

      await injector.ensureSharedServicesMountOverride(configRoot, "ws", "app");
      await injector.ensureSharedServicesMountOverride(configRoot, "ws", "app");

      const gitignore = await fs.readFile(path.join(configRoot, ".gitignore"), "utf8");
      const count = gitignore.split(".vbr-manager.override.yml").length - 1;
      expect(count).toBe(1);
    });

    it("uses custom appComposeServiceName in override", async () => {
      const config = makeConfig({ dindHomePath: tmpDir, appComposeServiceName: "web" });
      const injector = new RuntimeInjector(config);
      const configRoot = path.join(tmpDir, "configRoot");
      await fs.mkdir(configRoot, { recursive: true });

      await injector.ensureSharedServicesMountOverride(configRoot, "ws", "app");

      const content = await fs.readFile(path.join(configRoot, ".vbr-manager.override.yml"), "utf8");
      expect(content).toContain("web:");
      expect(content).not.toContain("  app:");
    });
  });

  describe("getAppServiceContainerId", () => {
    it("returns trimmed container ID", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "  abc123def  \n", stderr: "" });
      const injector = new RuntimeInjector(makeConfig());

      const id = await injector.getAppServiceContainerId("/path/docker-compose.yml");
      expect(id).toBe("abc123def");
    });

    it("passes override path when provided", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "abc123\n", stderr: "" });
      const injector = new RuntimeInjector(makeConfig());

      await injector.getAppServiceContainerId("/path/docker-compose.yml", "/path/override.yml");
      expect(mockRunCommand).toHaveBeenCalledWith(
        "docker",
        ["compose", "-f", "/path/docker-compose.yml", "-f", "/path/override.yml", "ps", "-q", "app"],
        expect.any(Object)
      );
    });

    it("throws when no container is found", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });
      const injector = new RuntimeInjector(makeConfig());

      await expect(injector.getAppServiceContainerId("/path/docker-compose.yml")).rejects.toThrow(
        "No running container found"
      );
    });
  });

  describe("injectIntoAppContainer", () => {
    it("returns empty warnings on clean exec", async () => {
      mockRunCommand.mockResolvedValue({ stdout: "ok\n", stderr: "" });
      const injector = new RuntimeInjector(makeConfig());

      const warnings = await injector.injectIntoAppContainer("abc123", "my-app", "ws");
      expect(warnings).toEqual([]);
    });

    it("extracts WARN lines from stdout/stderr", async () => {
      mockRunCommand.mockResolvedValue({
        stdout: "ok\nWARN: cannot install gh as non-root\n",
        stderr: "WARN: agent command exists but is not functional (likely libc mismatch)\n"
      });
      const injector = new RuntimeInjector(makeConfig());

      const warnings = await injector.injectIntoAppContainer("abc123", "my-app", "ws");
      expect(warnings).toHaveLength(2);
      expect(warnings[0]).toContain("cannot install gh");
      expect(warnings[1]).toContain("libc mismatch");
    });

    it("catches exec failure and returns it as a warning", async () => {
      mockRunCommand.mockRejectedValue(new Error("container not running"));
      const injector = new RuntimeInjector(makeConfig());

      const warnings = await injector.injectIntoAppContainer("abc123", "my-app", "ws");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Runtime setup failed");
      expect(warnings[0]).toContain("container not running");
    });
  });
});
