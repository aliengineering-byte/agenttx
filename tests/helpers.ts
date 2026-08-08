import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { CommandSpec, TransactionMetadata } from "../src/core/types.js";
import { createTransaction } from "../src/core/workspace.js";
import { runTransaction } from "../src/core/runner.js";

const execFileAsync = promisify(execFile);
export const builtCli = resolve("dist/src/cli.js");

export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  });
  return result.stdout;
}

export async function createRepository(files: Record<string, string | Buffer> = { "file.txt": "before\n" }): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agenttx-test-repo-"));
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  await git(directory, ["init", "-q"]);
  await git(directory, ["add", "-A"]);
  await git(directory, ["-c", "user.name=AgentTX Test", "-c", "user.email=test@agenttx.local", "commit", "-q", "-m", "baseline"]);
  return directory;
}

export async function isolatedHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "agenttx-test-home-"));
  process.env.AGENTTX_HOME = home;
  return home;
}

export async function runNodeTransaction(
  repository: string,
  source: string,
  options: { allowExternal?: boolean; agent?: string } = {}
): Promise<TransactionMetadata> {
  const command: CommandSpec = { command: process.execPath, args: ["-e", source] };
  const metadata = await createTransaction(repository, command, {
    allowExternal: options.allowExternal ?? false,
    agent: options.agent ?? "test-agent"
  });
  return (await runTransaction(metadata, builtCli, command)).metadata;
}

export async function text(path: string): Promise<string> {
  return readFile(path, "utf8");
}
