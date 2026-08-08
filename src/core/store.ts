import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { assertTransition } from "./state.js";
import { redactText, redactValue } from "./redaction.js";
import { SCHEMA_VERSION, type TransactionMetadata, type TransactionState } from "./types.js";
import { writeJsonAtomic } from "./fs.js";

export function agenttxHome(): string {
  return resolve(process.env.AGENTTX_HOME ?? join(homedir(), ".agenttx"));
}

export function transactionsDirectory(): string {
  return join(agenttxHome(), "transactions");
}

export function transactionDirectory(transactionId: string): string {
  if (!/^atx_[0-9]{8}_[0-9]{6}_[a-f0-9]{4,16}$/.test(transactionId)) {
    throw new Error(`Invalid transaction ID: ${transactionId}`);
  }
  return join(transactionsDirectory(), transactionId);
}

export function metadataPath(transactionId: string): string {
  return join(transactionDirectory(transactionId), "metadata.json");
}

export function createTransactionId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace("T", "_").slice(0, 15);
  return `atx_${timestamp}_${randomBytes(2).toString("hex")}`;
}

export async function ensureStore(): Promise<void> {
  await mkdir(transactionsDirectory(), { recursive: true, mode: 0o700 });
}

export async function writeMetadata(metadata: TransactionMetadata): Promise<void> {
  const safe = redactValue({ ...metadata, updatedAt: new Date().toISOString() });
  await writeJsonAtomic(metadataPath(metadata.transactionId), safe);
}

function validateMetadata(value: unknown, path: string): TransactionMetadata {
  if (!value || typeof value !== "object") throw new Error(`Invalid metadata in ${path}`);
  const candidate = value as Partial<TransactionMetadata>;
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported metadata schema in ${path}`);
  }
  if (typeof candidate.transactionId !== "string" || typeof candidate.status !== "string") {
    throw new Error(`Incomplete metadata in ${path}`);
  }
  return candidate as TransactionMetadata;
}

export async function readMetadata(transactionId: string): Promise<TransactionMetadata> {
  const path = metadataPath(transactionId);
  try {
    return validateMetadata(JSON.parse(await readFile(path, "utf8")), path);
  } catch (error) {
    throw new Error(redactText(`Cannot read transaction ${transactionId}: ${(error as Error).message}`));
  }
}

export async function transitionTransaction(
  metadata: TransactionMetadata,
  nextState: TransactionState,
  updates: Partial<TransactionMetadata> = {}
): Promise<TransactionMetadata> {
  assertTransition(metadata.status, nextState);
  const next: TransactionMetadata = {
    ...metadata,
    ...updates,
    status: nextState,
    updatedAt: new Date().toISOString()
  };
  await writeMetadata(next);
  return next;
}

export async function listTransactions(): Promise<TransactionMetadata[]> {
  await ensureStore();
  const entries = await readdir(transactionsDirectory(), { withFileTypes: true });
  const metadata: TransactionMetadata[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("atx_")) continue;
    try {
      metadata.push(await readMetadata(entry.name));
    } catch {
      // Corrupt transactions remain on disk for manual recovery, but do not break history.
    }
  }
  return metadata.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function resolveTransaction(
  id: string | undefined,
  cwd: string,
  includeTerminal = true
): Promise<TransactionMetadata> {
  if (id) return readMetadata(id);
  const resolvedCwd = resolve(cwd);
  const candidates = (await listTransactions()).filter((item) => {
    const belongsToWorkspace =
      resolvedCwd === resolve(item.repositoryRoot) ||
      resolvedCwd.startsWith(`${resolve(item.repositoryRoot)}${process.platform === "win32" ? "\\" : "/"}`);
    if (!belongsToWorkspace) return false;
    return includeTerminal || !["COMMITTED", "ROLLED_BACK"].includes(item.status);
  });
  const transaction = candidates[0];
  if (!transaction) {
    throw new Error(`No AgentTX transaction found for ${basename(resolvedCwd)}`);
  }
  return transaction;
}
