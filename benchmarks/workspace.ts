import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { transitionTransaction } from "../src/core/store.js";
import type { CommandSpec, TransactionMetadata } from "../src/core/types.js";
import {
  commitTransaction,
  createTransaction,
  finalizeTransaction,
  inspectDiff,
  rollbackTransaction
} from "../src/core/workspace.js";

const execFileAsync = promisify(execFile);

interface BenchmarkResult {
  files: number;
  approximateBytes: number;
  workspaceSetupMs: number;
  bookkeepingMs: number;
  diffMs: number;
  rollbackMs: number;
  commitWorkspaceSetupMs: number;
  commitMs: number;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", cwd, ...args], {
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
}

async function prepareRepository(size: number): Promise<{ repository: string; bytes: number }> {
  const repository = await mkdtemp(join(tmpdir(), `agenttx-benchmark-${size}-`));
  await mkdir(join(repository, "src"));
  let bytes = 0;
  const batchSize = 250;
  for (let start = 0; start < size; start += batchSize) {
    const writes: Promise<void>[] = [];
    for (let index = start; index < Math.min(start + batchSize, size); index += 1) {
      const content = `fixture ${String(index).padStart(6, "0")} ${"x".repeat(96)}\n`;
      bytes += Buffer.byteLength(content);
      writes.push(writeFile(join(repository, "src", `file-${String(index).padStart(6, "0")}.txt`), content));
    }
    await Promise.all(writes);
  }
  await git(repository, ["init", "-q"]);
  await git(repository, ["add", "-A"]);
  await git(repository, [
    "-c",
    "user.name=AgentTX Benchmark",
    "-c",
    "user.email=benchmark@agenttx.local",
    "commit",
    "-q",
    "-m",
    "baseline"
  ]);
  return { repository, bytes };
}

async function enterReview(metadata: TransactionMetadata): Promise<TransactionMetadata> {
  metadata = await transitionTransaction(metadata, "RUNNING");
  return transitionTransaction(metadata, "REVIEW");
}

async function measure(size: number): Promise<BenchmarkResult> {
  const { repository, bytes } = await prepareRepository(size);
  const store = await mkdtemp(join(tmpdir(), `agenttx-benchmark-home-${size}-`));
  process.env.AGENTTX_HOME = store;
  const command: CommandSpec = { command: process.execPath, args: ["-e", "process.exit(0)"] };
  try {
    const setupStarted = performance.now();
    let transaction = await createTransaction(repository, command, {
      allowExternal: false,
      agent: "benchmark"
    });
    const workspaceSetupMs = performance.now() - setupStarted;
    for (let index = 0; index < Math.min(5, size); index += 1) {
      await writeFile(join(transaction.worktree, "src", `file-${String(index).padStart(6, "0")}.txt`), `changed ${index}\n`);
    }
    transaction = await transitionTransaction(transaction, "RUNNING");
    const bookkeepingStarted = performance.now();
    await finalizeTransaction(transaction);
    const bookkeepingMs = performance.now() - bookkeepingStarted;
    transaction = await transitionTransaction(transaction, "REVIEW");
    const diffStarted = performance.now();
    await inspectDiff(transaction);
    const diffMs = performance.now() - diffStarted;
    const rollbackStarted = performance.now();
    await rollbackTransaction(transaction);
    const rollbackMs = performance.now() - rollbackStarted;

    const commitSetupStarted = performance.now();
    let commitCandidate = await createTransaction(repository, command, {
      allowExternal: false,
      agent: "benchmark"
    });
    const commitWorkspaceSetupMs = performance.now() - commitSetupStarted;
    await writeFile(join(commitCandidate.worktree, "src", "file-000000.txt"), "accepted\n");
    commitCandidate = await enterReview(commitCandidate);
    const commitStarted = performance.now();
    await commitTransaction(commitCandidate);
    const commitMs = performance.now() - commitStarted;
    const round = (value: number): number => Number(value.toFixed(2));
    return {
      files: size,
      approximateBytes: bytes,
      workspaceSetupMs: round(workspaceSetupMs),
      bookkeepingMs: round(bookkeepingMs),
      diffMs: round(diffMs),
      rollbackMs: round(rollbackMs),
      commitWorkspaceSetupMs: round(commitWorkspaceSetupMs),
      commitMs: round(commitMs)
    };
  } finally {
    await rm(repository, { recursive: true, force: true });
    await rm(store, { recursive: true, force: true });
  }
}

const requestedSizes = process.argv.slice(2).map(Number).filter((value) => Number.isInteger(value) && value > 0);
const sizes = requestedSizes.length ? requestedSizes : [100, 1_000, 10_000];
const results: BenchmarkResult[] = [];
for (const size of sizes) results.push(await measure(size));

process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  platform: process.platform,
  node: process.versions.node,
  git: (await execFileAsync("git", ["--version"], { encoding: "utf8", windowsHide: true })).stdout.trim(),
  results,
  note: "Single local samples. AgentTX V0 optimizes for correctness over workspace setup speed; these are not broad performance claims."
}, null, 2)}\n`);
