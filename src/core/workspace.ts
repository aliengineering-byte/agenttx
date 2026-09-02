import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rm } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { EventLedger } from "./ledger.js";
import {
  canonicalSha256,
  deriveWorkspaceStatusUnchanged,
  rollbackTransactionRecord,
  writeRollbackEvidence
} from "./evidence.js";
import { assertContained, assertSafeRelativePath, copyEntry, fingerprintPath, fingerprintsEqual, pathExists, toPosixPath, writeJsonAtomic } from "./fs.js";
import { findRepository, runGit, splitNull } from "./git.js";
import { redactText, sanitizeCommand } from "./redaction.js";
import {
  createTransactionId,
  ensureStore,
  listTransactions,
  readMetadata,
  transactionDirectory,
  transitionTransaction,
  writeMetadata
} from "./store.js";
import {
  SCHEMA_VERSION,
  type BeforeSnapshot,
  type CommandSpec,
  type DiffSummary,
  type FileChange,
  type FileFingerprint,
  type TransactionMetadata
} from "./types.js";

interface IndexEntry {
  mode: string;
  oid: string;
}

interface NumstatEntry {
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

function transactionPath(metadata: TransactionMetadata, name: string): string {
  return join(metadata.transactionDirectory, name);
}

async function repositoryPaths(repositoryRoot: string): Promise<string[]> {
  const [tracked, untracked] = await Promise.all([
    runGit(repositoryRoot, ["ls-files", "-z", "--cached"]),
    runGit(repositoryRoot, ["ls-files", "-z", "--others", "--exclude-standard"])
  ]);
  return [...new Set([...splitNull(tracked.stdout), ...splitNull(untracked.stdout)])].sort();
}

async function captureBefore(repositoryRoot: string, head: string): Promise<BeforeSnapshot> {
  const status = await runGit(repositoryRoot, ["status", "--short", "--untracked-files=all"]);
  const files: Record<string, FileFingerprint> = {};
  for (const path of await repositoryPaths(repositoryRoot)) {
    assertSafeRelativePath(path);
    const fingerprint = await fingerprintPath(join(repositoryRoot, path));
    if (fingerprint) files[toPosixPath(path)] = fingerprint;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    head,
    status: status.stdout.split(/\r?\n/).filter(Boolean),
    files
  };
}

async function workspaceStatusDigest(repositoryRoot: string): Promise<string | null> {
  try {
    const [head, status, trackedDiff, untrackedOutput] = await Promise.all([
      runGit(repositoryRoot, ["rev-parse", "HEAD"]),
      runGit(repositoryRoot, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]),
      runGit(repositoryRoot, ["diff", "--binary", "--full-index", "--no-ext-diff", "--no-textconv", "HEAD", "--"]),
      runGit(repositoryRoot, ["ls-files", "-z", "--others", "--exclude-standard"])
    ]);
    const untracked = await Promise.all(
      splitNull(untrackedOutput.stdout)
        .sort()
        .map(async (path) => ({ path, fingerprint: await fingerprintPath(join(repositoryRoot, path)) }))
    );
    return canonicalSha256({
      format: "agenttx-git-visible-content-v1",
      head: head.stdout.trim(),
      status: status.stdout,
      trackedDiff: trackedDiff.stdout,
      untracked
    });
  } catch {
    return null;
  }
}

async function validateRepository(repositoryRoot: string): Promise<string> {
  const bare = (await runGit(repositoryRoot, ["rev-parse", "--is-bare-repository"])).stdout.trim();
  if (bare === "true") throw new Error("AgentTX cannot run in a bare Git repository.");
  const head = await runGit(repositoryRoot, ["rev-parse", "--verify", "HEAD"], {
    allowFailure: true
  });
  if (!head.stdout.trim()) {
    throw new Error("AgentTX V0 requires a repository with at least one commit.");
  }
  const submodules = await runGit(repositoryRoot, ["ls-files", "--stage"]);
  if (submodules.stdout.split(/\r?\n/).some((line) => line.startsWith("160000 "))) {
    throw new Error("AgentTX V0 does not yet support repositories containing Git submodules.");
  }
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"]) {
    const path = (await runGit(repositoryRoot, ["rev-parse", "--git-path", marker])).stdout.trim();
    if (path && (await pathExists(resolve(repositoryRoot, path)))) {
      throw new Error(`Finish the repository's active ${marker.toLowerCase()} operation before starting AgentTX.`);
    }
  }
  return head.stdout.trim();
}

async function overlayDirtyWorkspace(repositoryRoot: string, worktree: string, head: string): Promise<void> {
  const [changed, untracked] = await Promise.all([
    runGit(repositoryRoot, ["diff", "--name-only", "-z", "--no-renames", head]),
    runGit(repositoryRoot, ["ls-files", "-z", "--others", "--exclude-standard"])
  ]);
  const paths = [...new Set([...splitNull(changed.stdout), ...splitNull(untracked.stdout)])];
  for (const path of paths) {
    assertSafeRelativePath(path);
    const source = join(repositoryRoot, path);
    const destination = join(worktree, path);
    assertContained(worktree, destination);
    if (await pathExists(source)) {
      await copyEntry(source, destination);
    } else {
      await rm(destination, { force: true, recursive: true });
    }
  }
}

async function createBaselineCommit(worktree: string, transactionId: string): Promise<string> {
  await runGit(worktree, ["add", "-A"]);
  await runGit(worktree, [
    "-c",
    "user.name=AgentTX",
    "-c",
    "user.email=transactions@agenttx.local",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--no-verify",
    "--no-gpg-sign",
    "--allow-empty",
    "-m",
    `AgentTX baseline ${transactionId}`
  ]);
  return (await runGit(worktree, ["rev-parse", "HEAD"])).stdout.trim();
}

async function configureTransactionRemote(
  repositoryRoot: string,
  worktree: string,
  allowExternal: boolean
): Promise<void> {
  const originalOrigin = await runGit(repositoryRoot, ["remote", "get-url", "origin"], {
    allowFailure: true
  });
  const url = originalOrigin.stdout.trim();
  if (!url) {
    await runGit(worktree, ["remote", "remove", "origin"], { allowFailure: true });
    return;
  }
  await runGit(worktree, ["remote", "set-url", "origin", url]);
  await runGit(worktree, [
    "remote",
    "set-url",
    "--push",
    "origin",
    allowExternal ? url : "agenttx://blocked"
  ]);
}

export async function createTransaction(
  cwd: string,
  command: CommandSpec,
  options: { allowExternal: boolean; agent: string }
): Promise<TransactionMetadata> {
  const repositoryRoot = await findRepository(cwd);
  const baseHead = await validateRepository(repositoryRoot);
  const invocationPath = await realpath(resolve(cwd));
  const invocationRelative = relative(repositoryRoot, invocationPath);
  if (invocationRelative.startsWith("..") || isAbsolute(invocationRelative)) {
    throw new Error("Invocation path is outside the repository.");
  }
  const transactionId = createTransactionId();
  await ensureStore();
  const directory = transactionDirectory(transactionId);
  const worktree = join(directory, "workspace");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const before = await captureBefore(repositoryRoot, baseHead);
  await writeJsonAtomic(join(directory, "before.json"), before);

  let worktreeCreated = false;
  try {
    await runGit(repositoryRoot, ["clone", "--quiet", "--no-hardlinks", "--no-checkout", repositoryRoot, worktree]);
    worktreeCreated = true;
    await runGit(worktree, ["checkout", "--force", baseHead]);
    await configureTransactionRemote(repositoryRoot, worktree, options.allowExternal);
    await overlayDirtyWorkspace(repositoryRoot, worktree, baseHead);
    const baselineCommit = await createBaselineCommit(worktree, transactionId);
    const now = new Date().toISOString();
    const safeCommand = sanitizeCommand(command.command, command.args);
    const metadata: TransactionMetadata = {
      schemaVersion: SCHEMA_VERSION,
      transactionId,
      createdAt: now,
      updatedAt: now,
      workspace: repositoryRoot,
      repositoryRoot,
      transactionDirectory: directory,
      worktree,
      invocationDirectory: toPosixPath(invocationRelative || "."),
      baselineCommit,
      baseHead,
      agent: options.agent,
      command: safeCommand,
      status: "CREATED",
      allowExternal: options.allowExternal,
      parentPid: process.pid
    };
    await writeMetadata(metadata);
    const ledger = new EventLedger(directory);
    await ledger.initialize();
    await ledger.append("transaction.created", {
      transactionId,
      repositoryRoot,
      baseHead,
      dirtyEntries: before.status.length,
      command: safeCommand,
      isolation: "independent-git-clone"
    });
    return metadata;
  } catch (error) {
    if (worktreeCreated) {
      assertContained(directory, worktree);
      await rm(worktree, { force: true, recursive: true });
    }
    throw new Error(redactText(`Failed to prepare AgentTX workspace: ${(error as Error).message}`));
  }
}

function parseIndexEntries(output: string, tree = false): Map<string, IndexEntry> {
  const entries = new Map<string, IndexEntry>();
  for (const record of splitNull(output)) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const header = record.slice(0, tab).split(" ");
    const path = record.slice(tab + 1);
    const mode = header[0];
    const oid = tree ? header[2] : header[1];
    const stage = tree ? "0" : header[2];
    if (mode && oid && stage === "0") entries.set(toPosixPath(path), { mode, oid });
  }
  return entries;
}

function parseNumstat(output: string): { byPath: Map<string, NumstatEntry>; totals: NumstatEntry } {
  const tokens = output.split("\0");
  const byPath = new Map<string, NumstatEntry>();
  let additions = 0;
  let deletions = 0;
  let binary = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const firstTab = token.indexOf("\t");
    const secondTab = token.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;
    const addedText = token.slice(0, firstTab);
    const deletedText = token.slice(firstTab + 1, secondTab);
    let path = token.slice(secondTab + 1);
    if (!path) {
      index += 2;
      path = tokens[index] ?? tokens[index - 1] ?? "";
    }
    const isBinary = addedText === "-" || deletedText === "-";
    const entry: NumstatEntry = {
      additions: isBinary ? null : Number(addedText),
      deletions: isBinary ? null : Number(deletedText),
      binary: isBinary
    };
    if (path) byPath.set(toPosixPath(path), entry);
    if (entry.additions !== null) additions += entry.additions;
    if (entry.deletions !== null) deletions += entry.deletions;
    binary ||= isBinary;
  }
  return {
    byPath,
    totals: { additions, deletions, binary }
  };
}

export async function inspectDiff(metadata: TransactionMetadata): Promise<DiffSummary> {
  if (!(await pathExists(metadata.worktree))) {
    const afterPath = transactionPath(metadata, "after.json");
    if (await pathExists(afterPath)) return JSON.parse(await readFile(afterPath, "utf8")) as DiffSummary;
    return { filesChanged: 0, additions: 0, deletions: 0, binaryFiles: 0, files: [] };
  }
  await runGit(metadata.worktree, ["add", "-A"]);
  const [baselineResult, indexResult, numstatResult] = await Promise.all([
    runGit(metadata.worktree, ["ls-tree", "-r", "-z", "--full-tree", metadata.baselineCommit]),
    runGit(metadata.worktree, ["ls-files", "-s", "-z"]),
    runGit(metadata.worktree, ["diff", "--cached", "--numstat", "-z", metadata.baselineCommit])
  ]);
  const baseline = parseIndexEntries(baselineResult.stdout, true);
  const current = parseIndexEntries(indexResult.stdout);
  const stats = parseNumstat(numstatResult.stdout);
  const deleted = [...baseline.keys()].filter((path) => !current.has(path));
  const added = [...current.keys()].filter((path) => !baseline.has(path));
  const modified = [...current.keys()].filter((path) => {
    const before = baseline.get(path);
    const after = current.get(path);
    return before && after && (before.oid !== after.oid || before.mode !== after.mode);
  });

  const files: FileChange[] = [];
  const pairedAdded = new Set<string>();
  const pairedDeleted = new Set<string>();
  for (const oldPath of deleted) {
    const oldEntry = baseline.get(oldPath);
    const newPath = added.find((candidate) => {
      if (pairedAdded.has(candidate)) return false;
      const newEntry = current.get(candidate);
      return oldEntry?.oid === newEntry?.oid && oldEntry?.mode === newEntry?.mode;
    });
    if (!newPath) continue;
    pairedDeleted.add(oldPath);
    pairedAdded.add(newPath);
    const stat = stats.byPath.get(newPath) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path: newPath, oldPath, kind: "renamed", ...stat });
  }
  for (const path of added.filter((value) => !pairedAdded.has(value))) {
    const stat = stats.byPath.get(path) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path, kind: "added", ...stat });
  }
  for (const path of modified) {
    const stat = stats.byPath.get(path) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path, kind: "modified", ...stat });
  }
  for (const path of deleted.filter((value) => !pairedDeleted.has(value))) {
    const stat = stats.byPath.get(path) ?? { additions: 0, deletions: 0, binary: false };
    files.push({ path, kind: "deleted", ...stat });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    filesChanged: files.length,
    additions: stats.totals.additions ?? 0,
    deletions: stats.totals.deletions ?? 0,
    binaryFiles: files.filter((file) => file.binary).length,
    files
  };
}

export async function finalizeTransaction(metadata: TransactionMetadata): Promise<TransactionMetadata> {
  if (!(await pathExists(metadata.worktree))) {
    throw new Error(`Transaction workspace is missing: ${metadata.worktree}`);
  }
  const diff = await inspectDiff(metadata);
  const patch = (await runGit(metadata.worktree, [
    "diff",
    "--cached",
    "--binary",
    "--full-index",
    metadata.baselineCommit
  ])).stdout;
  await writeJsonAtomic(transactionPath(metadata, "after.json"), diff);
  await writeJsonAtomic(transactionPath(metadata, "after-files.json"), {
    schemaVersion: SCHEMA_VERSION,
    capturedAt: new Date().toISOString(),
    files: diff.files
  });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(transactionPath(metadata, "diff.patch"), redactText(patch), { mode: 0o600 });
  return metadata;
}

export async function transactionPatch(metadata: TransactionMetadata): Promise<string> {
  const path = transactionPath(metadata, "diff.patch");
  if (await pathExists(path)) return readFile(path, "utf8");
  await finalizeTransaction(metadata);
  return readFile(path, "utf8");
}

async function readBefore(metadata: TransactionMetadata): Promise<BeforeSnapshot> {
  return JSON.parse(await readFile(transactionPath(metadata, "before.json"), "utf8")) as BeforeSnapshot;
}

function changedPaths(diff: DiffSummary): string[] {
  const paths = new Set<string>();
  for (const file of diff.files) {
    paths.add(file.path);
    if (file.oldPath) paths.add(file.oldPath);
  }
  return [...paths].sort();
}

async function compareOriginalToBaseline(
  metadata: TransactionMetadata,
  diff: DiffSummary,
  before: BeforeSnapshot
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const path of changedPaths(diff)) {
    assertSafeRelativePath(path);
    const current = await fingerprintPath(join(metadata.repositoryRoot, path));
    const expected = before.files[path] ?? null;
    if (!fingerprintsEqual(current, expected)) conflicts.push(path);
  }
  return conflicts;
}

async function restoreFromBackup(
  repositoryRoot: string,
  backupRoot: string,
  paths: readonly string[],
  before: BeforeSnapshot
): Promise<void> {
  for (const path of paths) {
    const destination = join(repositoryRoot, path);
    if (before.files[path]) {
      await copyEntry(join(backupRoot, path), destination);
    } else {
      await rm(destination, { force: true, recursive: true });
    }
  }
}

export async function commitTransaction(metadata: TransactionMetadata): Promise<{
  metadata: TransactionMetadata;
  diff: DiffSummary;
}> {
  if (metadata.status !== "REVIEW") {
    throw new Error(`Transaction ${metadata.transactionId} is ${metadata.status}; only REVIEW can be committed.`);
  }
  await finalizeTransaction(metadata);
  const diff = await inspectDiff(metadata);
  const before = await readBefore(metadata);
  const conflicts = await compareOriginalToBaseline(metadata, diff, before);
  if (conflicts.length) {
    throw new Error(
      `AgentTX could not accept this transaction because the original workspace changed while the agent was running.\n\nChanged outside AgentTX:\n${conflicts.map((path) => `  ${path}`).join("\n")}\n\nYour existing work was not overwritten. No transaction files were applied.\n\nNext:\n  agenttx diff ${metadata.transactionId}\n  agenttx rollback ${metadata.transactionId}`
    );
  }
  const paths = changedPaths(diff);
  const backupRoot = transactionPath(metadata, "commit-backup");
  assertContained(metadata.transactionDirectory, backupRoot);
  await rm(backupRoot, { force: true, recursive: true });
  await mkdir(backupRoot, { recursive: true, mode: 0o700 });
  for (const path of paths) {
    if (before.files[path]) await copyEntry(join(metadata.repositoryRoot, path), join(backupRoot, path));
  }
  const ledger = new EventLedger(metadata.transactionDirectory);
  await ledger.append("commit.started", { paths: paths.length });
  try {
    const deletions = diff.files.flatMap((file) => {
      if (file.kind === "deleted") return [file.path];
      if (file.kind === "renamed" && file.oldPath) return [file.oldPath];
      return [];
    });
    for (const path of deletions) {
      await rm(join(metadata.repositoryRoot, path), { force: true, recursive: true });
    }
    for (const file of diff.files) {
      if (file.kind === "deleted") continue;
      await copyEntry(join(metadata.worktree, file.path), join(metadata.repositoryRoot, file.path));
    }
    for (const file of diff.files) {
      const expected = file.kind === "deleted" ? null : await fingerprintPath(join(metadata.worktree, file.path));
      const current = await fingerprintPath(join(metadata.repositoryRoot, file.path));
      if (!fingerprintsEqual(expected, current)) {
        throw new Error(`Post-commit verification failed for ${file.path}`);
      }
      if (file.kind === "renamed" && file.oldPath) {
        const old = await fingerprintPath(join(metadata.repositoryRoot, file.oldPath));
        if (old) throw new Error(`Post-commit verification failed for deleted path ${file.oldPath}`);
      }
    }
  } catch (error) {
    try {
      await restoreFromBackup(metadata.repositoryRoot, backupRoot, paths, before);
    } catch (restoreError) {
      throw new Error(
        `Commit failed and automatic restoration also failed. Recovery backup: ${backupRoot}. Cause: ${(error as Error).message}. Restore error: ${(restoreError as Error).message}`
      );
    }
    throw new Error(`Commit failed; the original workspace was restored. ${(error as Error).message}`);
  }

  metadata = await transitionTransaction(metadata, "COMMITTED", {
    completedAt: new Date().toISOString()
  });
  await ledger.append("commit.completed", { filesChanged: diff.filesChanged });
  await rm(backupRoot, { force: true, recursive: true });
  try {
    assertContained(metadata.transactionDirectory, metadata.worktree);
    await rm(metadata.worktree, { force: true, recursive: true });
  } catch (error) {
    if (await pathExists(metadata.worktree)) {
      metadata = { ...metadata, cleanupWarning: redactText((error as Error).message) };
      await writeMetadata(metadata);
    }
  }
  return { metadata, diff };
}

export async function rollbackTransaction(metadata: TransactionMetadata): Promise<{
  metadata: TransactionMetadata;
  diff: DiffSummary;
  evidencePath: string | null;
  evidenceWarning: string | null;
  originalWorkspaceStatusUnchanged: boolean | null;
}> {
  if (!["CREATED", "REVIEW", "FAILED", "ABORTED"].includes(metadata.status)) {
    throw new Error(`Transaction ${metadata.transactionId} is ${metadata.status} and cannot be rolled back.`);
  }
  const diff = await inspectDiff(metadata);
  await writeJsonAtomic(transactionPath(metadata, "after.json"), diff);
  const workspaceStatusBefore = await workspaceStatusDigest(metadata.repositoryRoot);
  const ledger = new EventLedger(metadata.transactionDirectory);
  await ledger.append("rollback.started", { filesChanged: diff.filesChanged });
  try {
    assertContained(metadata.transactionDirectory, metadata.worktree);
    await rm(metadata.worktree, { force: true, recursive: true });
  } catch (error) {
    throw new Error(`Rollback could not remove the isolated workspace: ${redactText((error as Error).message)}`);
  }
  metadata = await transitionTransaction(metadata, "ROLLED_BACK", {
    completedAt: new Date().toISOString()
  });
  const workspaceStatusAfter = await workspaceStatusDigest(metadata.repositoryRoot);
  const originalWorkspaceStatusUnchanged = deriveWorkspaceStatusUnchanged(
    workspaceStatusBefore,
    workspaceStatusAfter
  );
  const transactionSha256 = canonicalSha256(rollbackTransactionRecord(metadata));
  await ledger.append("rollback.completed", {
    filesDiscarded: diff.filesChanged,
    diffSha256: createHash("sha256").update(JSON.stringify(diff)).digest("hex"),
    transactionSha256,
    workspaceStatusBefore,
    workspaceStatusAfter
  });
  let evidencePath: string | null = null;
  let evidenceWarning: string | null = null;
  try {
    evidencePath = await writeRollbackEvidence(metadata);
  } catch (error) {
    evidenceWarning = redactText((error as Error).message);
  }
  return {
    metadata,
    diff,
    evidencePath,
    evidenceWarning,
    originalWorkspaceStatusUnchanged
  };
}

export function processIsRunning(pid: number | undefined): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export async function recoverInterruptedTransactions(): Promise<TransactionMetadata[]> {
  const recovered: TransactionMetadata[] = [];
  for (let metadata of await listTransactions()) {
    if (metadata.status !== "RUNNING" || processIsRunning(metadata.parentPid)) continue;
    const ledger = new EventLedger(metadata.transactionDirectory);
    try {
      await finalizeTransaction(metadata);
      metadata = await transitionTransaction(metadata, "REVIEW", {
        interrupted: true,
        completedAt: new Date().toISOString(),
        exitCode: null,
        failure: "AgentTX process ended before the child exit was recorded. Resume is unsupported in V0."
      });
      await ledger.append("transaction.recovered", {
        previousState: "RUNNING",
        resumeSupported: false
      });
      recovered.push(metadata);
    } catch (error) {
      metadata = await readMetadata(metadata.transactionId);
      if (metadata.status === "RUNNING") {
        metadata = await transitionTransaction(metadata, "FAILED", {
          interrupted: true,
          completedAt: new Date().toISOString(),
          failure: redactText((error as Error).message)
        });
      }
      recovered.push(metadata);
    }
  }
  return recovered;
}

export function transactionDisplayName(metadata: TransactionMetadata): string {
  return `${metadata.agent || basename(metadata.command.command)} (${metadata.transactionId})`;
}
