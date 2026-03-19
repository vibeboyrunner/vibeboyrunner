import net from "net";
import { log } from "../utils/logger";
import { runCommand } from "../utils/process";

interface AllocatorState {
  usedPorts: Set<number>;
  cursor: number;
}

export class PortAllocator {
  constructor(
    private readonly poolStart: number,
    private readonly poolEnd: number
  ) {}

  async createState(): Promise<AllocatorState> {
    return {
      usedPorts: await this.getDockerUsedPorts(),
      cursor: this.poolStart
    };
  }

  async allocate(state: AllocatorState, preferred: string | number): Promise<number> {
    const preferredPort = Number.parseInt(String(preferred), 10);
    if (
      Number.isInteger(preferredPort) &&
      preferredPort >= this.poolStart &&
      preferredPort <= this.poolEnd &&
      !state.usedPorts.has(preferredPort) &&
      (await this.isPortFree(preferredPort))
    ) {
      state.usedPorts.add(preferredPort);
      return preferredPort;
    }

    const span = this.poolEnd - this.poolStart + 1;
    for (let offset = 0; offset < span; offset += 1) {
      const candidate = this.poolStart + ((state.cursor - this.poolStart + offset + span) % span);
      if (state.usedPorts.has(candidate)) {
        continue;
      }
      if (await this.isPortFree(candidate)) {
        state.usedPorts.add(candidate);
        state.cursor = candidate + 1 > this.poolEnd ? this.poolStart : candidate + 1;
        return candidate;
      }
    }

    throw new Error(`No free ports available in pool ${this.poolStart}-${this.poolEnd}`);
  }

  private async getDockerUsedPorts(): Promise<Set<number>> {
    const used = new Set<number>();
    try {
      const { stdout } = await runCommand("docker", ["ps", "--format", "{{.Ports}}"]);
      const re = /(\d+)(?:-(\d+))?->/g;
      for (const line of stdout.split("\n")) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(line)) !== null) {
          const start = Number.parseInt(match[1], 10);
          const end = match[2] ? Number.parseInt(match[2], 10) : start;
          for (let port = start; port <= end; port += 1) {
            used.add(port);
          }
        }
      }
    } catch (error) {
      log("WARN", "Failed to inspect docker ports, proceeding with socket probing only", {
        error: String(error)
      });
    }
    return used;
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen(port, "0.0.0.0");
    });
  }
}
