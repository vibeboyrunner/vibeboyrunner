import { LogLevel } from "../types";

export function log(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  const event = {
    ts: new Date().toISOString(),
    service: "manager",
    level,
    message,
    ...meta
  };
  console.log(JSON.stringify(event));
}
