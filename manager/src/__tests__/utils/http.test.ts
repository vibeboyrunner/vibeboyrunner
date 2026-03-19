import { describe, it, expect, vi } from "vitest";
import { IncomingMessage, ServerResponse } from "http";
import { Readable, Writable } from "stream";
import { Socket } from "net";
import { sendJson, readBody, parseJsonObject } from "../../utils/http";

function createMockResponse(): { res: ServerResponse; getStatus: () => number; getBody: () => string; getHeader: (name: string) => string | undefined } {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  const res = new ServerResponse(req);

  let written = "";
  let capturedStatus = 0;
  const capturedHeaders: Record<string, string> = {};

  const origWriteHead = res.writeHead.bind(res);
  res.writeHead = function (...args: any[]) {
    capturedStatus = args[0] as number;
    const headersArg = args.length > 1 ? args[args.length - 1] : undefined;
    if (headersArg && typeof headersArg === "object" && !Array.isArray(headersArg)) {
      for (const [k, v] of Object.entries(headersArg)) {
        capturedHeaders[k] = String(v);
      }
    }
    return res as any;
  } as any;

  const origEnd = res.end.bind(res);
  res.end = function (data?: any) {
    if (data) written += String(data);
    return res as any;
  } as any;

  return {
    res,
    getStatus: () => capturedStatus,
    getBody: () => written,
    getHeader: (name: string) => capturedHeaders[name]
  };
}

function createMockRequest(body: string): IncomingMessage {
  const readable = new Readable();
  readable.push(body);
  readable.push(null);
  Object.assign(readable, {
    method: "POST",
    url: "/",
    headers: {},
    setEncoding: readable.setEncoding.bind(readable)
  });
  return readable as unknown as IncomingMessage;
}

describe("sendJson", () => {
  it("sends JSON with correct status code and headers", () => {
    const mock = createMockResponse();
    sendJson(mock.res, 200, { ok: true, data: "hello" });

    expect(mock.getStatus()).toBe(200);
    expect(mock.getHeader("Content-Type")).toBe("application/json");
    expect(mock.getHeader("Content-Length")).toBe(String(Buffer.byteLength('{"ok":true,"data":"hello"}')));
    expect(JSON.parse(mock.getBody())).toEqual({ ok: true, data: "hello" });
  });

  it("sends error response with 4xx status", () => {
    const mock = createMockResponse();
    sendJson(mock.res, 400, { ok: false, error: "bad request" });

    expect(mock.getStatus()).toBe(400);
    expect(JSON.parse(mock.getBody())).toEqual({ ok: false, error: "bad request" });
  });

  it("handles nested objects", () => {
    const mock = createMockResponse();
    const payload = { nested: { deep: { value: 42 } }, arr: [1, 2, 3] };
    sendJson(mock.res, 200, payload);

    expect(JSON.parse(mock.getBody())).toEqual(payload);
  });
});

describe("readBody", () => {
  it("reads request body as string", async () => {
    const req = createMockRequest('{"key":"value"}');
    const body = await readBody(req);
    expect(body).toBe('{"key":"value"}');
  });

  it("reads empty body", async () => {
    const req = createMockRequest("");
    const body = await readBody(req);
    expect(body).toBe("");
  });

  it("rejects when body exceeds 1MB", async () => {
    const largeBody = "x".repeat(1024 * 1024 + 1);
    const readable = new Readable();
    Object.assign(readable, {
      method: "POST",
      url: "/",
      headers: {},
      setEncoding: readable.setEncoding.bind(readable)
    });

    const req = readable as unknown as IncomingMessage;
    const promise = readBody(req);

    readable.push(largeBody);
    readable.push(null);

    await expect(promise).rejects.toThrow("Request body too large");
  });
});

describe("parseJsonObject", () => {
  it("parses valid JSON object", () => {
    const result = parseJsonObject('{"key":"value","num":42}');
    expect(result).toEqual({ key: "value", num: 42 });
  });

  it("returns empty object for empty string", () => {
    expect(parseJsonObject("")).toEqual({});
  });

  it("returns empty object for whitespace-only string", () => {
    expect(parseJsonObject("   ")).toEqual({});
  });

  it("throws for JSON array", () => {
    expect(() => parseJsonObject("[1,2,3]")).toThrow("Request body must be a JSON object");
  });

  it("throws for JSON primitive string", () => {
    expect(() => parseJsonObject('"hello"')).toThrow("Request body must be a JSON object");
  });

  it("throws for invalid JSON", () => {
    expect(() => parseJsonObject("{invalid}")).toThrow();
  });

  it("throws for null JSON", () => {
    expect(() => parseJsonObject("null")).toThrow("Request body must be a JSON object");
  });
});
