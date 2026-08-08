import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { delimiter } from "node:path";

const execFileAsync = promisify(execFile);

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function runGit(
  cwd: string,
  args: readonly string[],
  options: { allowFailure?: boolean; encoding?: BufferEncoding } = {}
): Promise<GitResult> {
  try {
    const result = await execFileAsync("git", ["-c", "color.ui=false", "-C", cwd, ...args], {
      encoding: options.encoding ?? "utf8",
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
      env: process.env
    });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
    if (options.allowFailure) {
      return { stdout: failure.stdout ?? "", stderr: failure.stderr ?? failure.message };
    }
    throw new Error(`git ${args.join(" ")} failed: ${(failure.stderr ?? failure.message).trim()}`);
  }
}

export async function findRepository(cwd: string): Promise<string> {
  const result = await runGit(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  const root = result.stdout.trim();
  if (!root) throw new Error("AgentTX V0 currently requires a Git repository.");
  return realpath(root);
}

export function splitNull(value: string): string[] {
  return value.split("\0").filter((entry) => entry.length > 0);
}

export function prependPath(directory: string, existing = process.env.PATH ?? ""): string {
  return `${directory}${delimiter}${existing}`;
}
