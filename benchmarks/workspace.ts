import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { transitionTransaction } from "../src/core/store.js";
import type { CommandSpec } from "../src/core/types.js";
import { commitTransaction, createTransaction, inspectDiff, rollbackTransaction } from "../src/core/workspace.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args], { windowsHide: true });
}

async function prepareRepository(): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), "agenttx-benchmark-repo-"));
  await mkdir(join(repository, "src"));
  for (let index = 0; index < 100; index += 1) {
    await writeFile(join(repository, "src", `file-${index}.txt`), `baseline ${index}\n`);
  }
  await git(repository, ["init", "-q"]);
  await git(repository, ["add", "-A"]);
  await git(repository, ["-c", "user.name=AgentTX Benchmark", "-c", "user.email=benchmark@agenttx.local", "commit", "-q", "-m", "baseline"]);
  return repository;
}

async function measure(): Promise<void> {
  const repository = await prepareRepository();
  const store = await mkdtemp(join(tmpdir(), "agenttx-benchmark-home-"));
  process.env.AGENTTX_HOME = store;
  const command: CommandSpec = { command: process.execPath, args: ["-e", "process.exit(0)"] };
  const setupStarted = performance.now();
  let transaction = await createTransaction(repository, command, { allowExternal: false, agent: "benchmark" });
  const setupMs = performance.now() - setupStarted;
  await writeFile(join(transaction.worktree, "src", "file-0.txt"), "changed\n");
  transaction = await transitionTransaction(transaction, "RUNNING");
  transaction = await transitionTransaction(transaction, "REVIEW");
  const inspectStarted = performance.now();
  await inspectDiff(transaction);
  const bookkeepingMs = performance.now() - inspectStarted;
  const rollbackStarted = performance.now();
  await rollbackTransaction(transaction);
  const rollbackMs = performance.now() - rollbackStarted;

  const commitSetupStarted = performance.now();
  let commitCandidate = await createTransaction(repository, command, { allowExternal: false, agent: "benchmark" });
  const commitSetupMs = performance.now() - commitSetupStarted;
  await writeFile(join(commitCandidate.worktree, "src", "file-1.txt"), "accepted\n");
  commitCandidate = await transitionTransaction(commitCandidate, "RUNNING");
  commitCandidate = await transitionTransaction(commitCandidate, "REVIEW");
  const commitStarted = performance.now();
  await commitTransaction(commitCandidate);
  const commitMs = performance.now() - commitStarted;

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    fixtureFiles: 100,
    platform: process.platform,
    node: process.versions.node,
    samples: {
      workspaceSetupMs: Number(setupMs.toFixed(2)),
      transactionBookkeepingMs: Number(bookkeepingMs.toFixed(2)),
      rollbackMs: Number(rollbackMs.toFixed(2)),
      secondWorkspaceSetupMs: Number(commitSetupMs.toFixed(2)),
      commitMs: Number(commitMs.toFixed(2))
    },
    note: "Local single-run measurement; not a published performance claim."
  }, null, 2)}\n`);
  await rm(repository, { recursive: true, force: true });
  await rm(store, { recursive: true, force: true });
}

await measure();
