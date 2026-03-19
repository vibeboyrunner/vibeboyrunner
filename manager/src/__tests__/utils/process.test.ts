import { describe, it, expect } from "vitest";
import { runCommand } from "../../utils/process";

describe("runCommand", () => {
  it("captures stdout from a successful command", async () => {
    const { stdout, stderr } = await runCommand("echo", ["hello world"]);
    expect(stdout.trim()).toBe("hello world");
    expect(stderr).toBe("");
  });

  it("captures stderr from a successful command", async () => {
    const { stdout, stderr } = await runCommand("sh", ["-c", "echo err >&2"]);
    expect(stderr.trim()).toBe("err");
  });

  it("rejects on non-zero exit code", async () => {
    await expect(runCommand("sh", ["-c", "exit 1"])).rejects.toThrow("failed with code 1");
  });

  it("includes stdout and stderr in error message", async () => {
    await expect(
      runCommand("sh", ["-c", "echo out; echo err >&2; exit 42"])
    ).rejects.toThrow(/failed with code 42[\s\S]*stdout:[\s\S]*out[\s\S]*stderr:[\s\S]*err/);
  });

  it("rejects when command does not exist", async () => {
    await expect(runCommand("nonexistent_binary_xyz", [])).rejects.toThrow();
  });

  it("respects cwd option", async () => {
    const { stdout } = await runCommand("pwd", [], { cwd: "/tmp" });
    expect(stdout.trim()).toMatch(/\/tmp/);
  });

  it("respects env option", async () => {
    const { stdout } = await runCommand("sh", ["-c", "echo $TEST_VAR_XYZ"], {
      env: { ...process.env, TEST_VAR_XYZ: "hello123" }
    });
    expect(stdout.trim()).toBe("hello123");
  });
});
