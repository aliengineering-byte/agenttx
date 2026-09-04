import { spawn } from "node:child_process";

export interface GateResult {
  exitCode: number;
  durationMs: number;
  terminationReason: "exit" | "signal" | "timeout" | "output-limit" | "spawn-error";
}

export async function runGate(
  argv: readonly string[],
  options: { cwd: string; timeoutMs: number; maxOutputBytes: number; shell: boolean }
): Promise<GateResult> {
  if (!argv[0]) throw new Error("Gate command is empty.");
  const started = Date.now();
  let bytes = 0;
  let terminationReason: GateResult["terminationReason"] = "exit";
  return new Promise((resolve) => {
    const child = spawn(argv[0] as string, argv.slice(1), {
      cwd: options.cwd,
      env: process.env,
      shell: options.shell,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ exitCode, durationMs: Date.now() - started, terminationReason });
    };
    const consume = (chunk: Buffer): void => {
      bytes += chunk.length;
      if (bytes > options.maxOutputBytes && terminationReason === "exit") {
        terminationReason = "output-limit";
        child.kill("SIGTERM");
      }
    };
    child.stdout?.on("data", consume);
    child.stderr?.on("data", consume);
    child.once("error", () => {
      terminationReason = "spawn-error";
      finish(1);
    });
    child.once("close", (code, signal) => {
      if (terminationReason === "exit" && signal) terminationReason = "signal";
      finish(code ?? 1);
    });
    timer = setTimeout(() => {
      if (settled) return;
      terminationReason = "timeout";
      child.kill("SIGTERM");
    }, options.timeoutMs);
    timer.unref();
  });
}
