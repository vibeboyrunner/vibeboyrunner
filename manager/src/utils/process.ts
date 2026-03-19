import { spawn } from "child_process";

interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], options: CommandOptions = {}): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${command} ${args.join(" ")} failed with code ${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
        )
      );
    });
  });
}
