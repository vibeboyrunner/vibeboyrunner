import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../../utils/logger";

describe("log", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("outputs valid JSON", () => {
    log("INFO", "test message");
    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it("includes required fields", () => {
    log("INFO", "hello world");
    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event).toHaveProperty("ts");
    expect(event.service).toBe("manager");
    expect(event.level).toBe("INFO");
    expect(event.message).toBe("hello world");
  });

  it("includes metadata fields", () => {
    log("ERROR", "failure", { code: 500, detail: "something broke" });
    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event.code).toBe(500);
    expect(event.detail).toBe("something broke");
    expect(event.level).toBe("ERROR");
  });

  it("produces ISO 8601 timestamp", () => {
    log("WARN", "test");
    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(new Date(event.ts).toISOString()).toBe(event.ts);
  });

  it("works without metadata", () => {
    log("INFO", "no meta");
    const event = JSON.parse(consoleSpy.mock.calls[0][0] as string);
    expect(event.message).toBe("no meta");
    expect(Object.keys(event)).toEqual(expect.arrayContaining(["ts", "service", "level", "message"]));
  });
});
