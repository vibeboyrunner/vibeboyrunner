import { describe, it, expect, vi, beforeEach } from "vitest";
import { PortAllocator } from "../../services/portAllocator";

vi.mock("../../utils/process", () => ({
  runCommand: vi.fn()
}));

vi.mock("../../utils/logger", () => ({
  log: vi.fn()
}));

let portFreeOverride: ((port: number) => boolean) | null = null;

function createMockServer() {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  return {
    once(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = cb;
      return this;
    },
    listen(port: number) {
      const isFree = portFreeOverride ? portFreeOverride(port) : true;
      if (isFree && listeners.listening) {
        listeners.listening();
      } else if (!isFree && listeners.error) {
        listeners.error(new Error("EADDRINUSE"));
      }
    },
    close(cb: () => void) {
      cb();
    }
  };
}

vi.mock("net", () => {
  const mock = { createServer: vi.fn(() => createMockServer()) };
  return { default: mock, ...mock };
});

import { runCommand } from "../../utils/process";
const mockRunCommand = vi.mocked(runCommand);

describe("PortAllocator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    portFreeOverride = null;
    mockRunCommand.mockResolvedValue({ stdout: "", stderr: "" });
  });

  describe("createState", () => {
    it("initializes with cursor at pool start", async () => {
      const allocator = new PortAllocator(30000, 30099);
      const state = await allocator.createState();
      expect(state.cursor).toBe(30000);
      expect(state.usedPorts).toBeInstanceOf(Set);
    });

    it("parses docker ps output for used ports", async () => {
      mockRunCommand.mockResolvedValue({
        stdout: "0.0.0.0:20001->3000/tcp\n0.0.0.0:20005->8080/tcp\n",
        stderr: ""
      });
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      expect(state.usedPorts.has(20001)).toBe(true);
      expect(state.usedPorts.has(20005)).toBe(true);
    });

    it("parses port ranges from docker ps", async () => {
      mockRunCommand.mockResolvedValue({
        stdout: "0.0.0.0:20010-20012->3000-3002/tcp\n",
        stderr: ""
      });
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      expect(state.usedPorts.has(20010)).toBe(true);
      expect(state.usedPorts.has(20011)).toBe(true);
      expect(state.usedPorts.has(20012)).toBe(true);
    });

    it("handles docker ps failure gracefully", async () => {
      mockRunCommand.mockRejectedValue(new Error("docker not found"));
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      expect(state.usedPorts.size).toBe(0);
    });
  });

  describe("allocate", () => {
    it("returns preferred port when available and in range", async () => {
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      const port = await allocator.allocate(state, 20050);
      expect(port).toBe(20050);
    });

    it("marks allocated port as used", async () => {
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      await allocator.allocate(state, 20050);
      expect(state.usedPorts.has(20050)).toBe(true);
    });

    it("skips preferred port when already used", async () => {
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      state.usedPorts.add(20050);
      const port = await allocator.allocate(state, 20050);
      expect(port).not.toBe(20050);
      expect(port).toBeGreaterThanOrEqual(20000);
      expect(port).toBeLessThanOrEqual(20099);
    });

    it("skips preferred port when out of range", async () => {
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      const port = await allocator.allocate(state, 9999);
      expect(port).toBeGreaterThanOrEqual(20000);
      expect(port).toBeLessThanOrEqual(20099);
    });

    it("allocates multiple unique ports sequentially", async () => {
      const allocator = new PortAllocator(20000, 20004);
      const state = await allocator.createState();
      const ports = new Set<number>();
      for (let i = 0; i < 5; i++) {
        ports.add(await allocator.allocate(state, 20000 + i));
      }
      expect(ports.size).toBe(5);
    });

    it("throws when pool is exhausted", async () => {
      const allocator = new PortAllocator(20000, 20002);
      const state = await allocator.createState();
      for (let i = 20000; i <= 20002; i++) {
        state.usedPorts.add(i);
      }
      await expect(allocator.allocate(state, 20000)).rejects.toThrow("No free ports available");
    });

    it("handles string preferred port", async () => {
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      const port = await allocator.allocate(state, "20030");
      expect(port).toBe(20030);
    });

    it("skips ports that are occupied on the host", async () => {
      portFreeOverride = (port: number) => port !== 20050;
      const allocator = new PortAllocator(20000, 20099);
      const state = await allocator.createState();
      const port = await allocator.allocate(state, 20050);
      expect(port).not.toBe(20050);
      expect(port).toBeGreaterThanOrEqual(20000);
      expect(port).toBeLessThanOrEqual(20099);
    });

    it("throws when all ports are occupied on the host", async () => {
      portFreeOverride = () => false;
      const allocator = new PortAllocator(20000, 20002);
      const state = await allocator.createState();
      await expect(allocator.allocate(state, 20000)).rejects.toThrow("No free ports available");
    });
  });
});
