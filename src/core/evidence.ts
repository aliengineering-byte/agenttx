import { createHash } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { VERSION } from "../version.js";
import { EventLedger, eventDigest } from "./ledger.js";
import type {
  DiffSummary,
  EvidenceVerification,
  RollbackEvidence,
  RollbackReceipt,
  TransactionEvent,
  TransactionMetadata
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT_ID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
const TRANSACTION_ID = /^atx_[0-9]{8}_[0-9]{6}_[a-f0-9]{4,16}$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const WORKSPACE_ALGORITHM = "sha256(agenttx-git-visible-content-v1)" as const;
const CANONICAL_ALGORITHM = "sha256(agenttx-canonical-json-v1)" as const;

interface RollbackCompletedData {
  filesDiscarded: number;
  workspaceStatusBefore: string | null;
  workspaceStatusAfter: string | null;
  diffSha256: string;
  transactionSha256: string;
}

export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot encode a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(",")}}`;
  }
  throw new Error(`Canonical JSON cannot encode ${typeof value}.`);
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalStringify(value)).digest("hex");
}

export function deriveWorkspaceStatusUnchanged(
  before: string | null,
  after: string | null
): boolean | null {
  return before === null || after === null ? null : before === after;
}

export function rollbackTransactionRecord(
  metadata: TransactionMetadata
): RollbackReceipt["transaction"] {
  if (metadata.status !== "ROLLED_BACK" || !metadata.completedAt) {
    throw new Error(`Transaction ${metadata.transactionId} is not a completed rollback.`);
  }
  if (!TRANSACTION_ID.test(metadata.transactionId)) throw new Error("Invalid transaction ID in metadata.");
  if (!GIT_OBJECT_ID.test(metadata.baselineCommit) || !GIT_OBJECT_ID.test(metadata.baseHead)) {
    throw new Error("Invalid Git object ID in transaction metadata.");
  }
  assertIsoTimestamp(metadata.completedAt, "transaction completedAt");
  return {
    transactionId: metadata.transactionId,
    baselineCommit: metadata.baselineCommit,
    baseHead: metadata.baseHead,
    state: "ROLLED_BACK",
    completedAt: metadata.completedAt
  };
}

function rollbackCompletedData(event: TransactionEvent | undefined): RollbackCompletedData {
  if (!event || event.type !== "rollback.completed") {
    throw new Error("Transaction ledger has no terminal rollback event.");
  }
  const data = event.data as Partial<RollbackCompletedData>;
  if (
    !isNonnegativeInteger(data.filesDiscarded) ||
    !isDigestOrNull(data.workspaceStatusBefore) ||
    !isDigestOrNull(data.workspaceStatusAfter) ||
    !isDigest(data.diffSha256) ||
    !isDigest(data.transactionSha256)
  ) {
    throw new Error("Terminal rollback event is missing verifiable evidence fields.");
  }
  return data as RollbackCompletedData;
}

export async function buildRollbackEvidence(metadata: TransactionMetadata): Promise<RollbackEvidence> {
  const transaction = rollbackTransactionRecord(metadata);
  const [diff, events] = await Promise.all([
    readFile(join(metadata.transactionDirectory, "after.json"), "utf8").then(
      (value) => JSON.parse(value) as DiffSummary
    ),
    new EventLedger(metadata.transactionDirectory).read()
  ]);
  const terminalEvent = events.at(-1);
  if (!terminalEvent) throw new Error("Transaction ledger is empty.");
  const terminal = rollbackCompletedData(terminalEvent);
  const diffSha256 = createHash("sha256").update(JSON.stringify(diff)).digest("hex");
  const transactionSha256 = canonicalSha256(transaction);
  if (terminal.diffSha256 !== diffSha256 || terminal.filesDiscarded !== diff.filesChanged) {
    throw new Error("Transaction diff does not match the terminal rollback event.");
  }
  if (terminal.transactionSha256 !== transactionSha256) {
    throw new Error("Transaction metadata does not match the terminal rollback event.");
  }
  const { hash: finalHash, ...terminalWithoutHash } = terminalEvent;
  const receipt: RollbackReceipt = {
    schemaVersion: 1,
    evidenceType: "agenttx.rollback",
    producer: {
      repository: "aliengineering-byte/agenttx",
      version: VERSION,
      capability: "repository-transaction-rollback",
      documentation: "https://github.com/aliengineering-byte/agenttx/blob/main/docs/SCHEMAS.md#rollback-evidence"
    },
    transaction,
    result: {
      filesDiscarded: diff.filesChanged,
      additionsDiscarded: diff.additions,
      deletionsDiscarded: diff.deletions,
      binaryFilesDiscarded: diff.binaryFiles,
      originalWorkspaceStatusUnchanged: deriveWorkspaceStatusUnchanged(
        terminal.workspaceStatusBefore,
        terminal.workspaceStatusAfter
      )
    },
    workspaceStatusEvidence: {
      algorithm: WORKSPACE_ALGORITHM,
      before: terminal.workspaceStatusBefore,
      after: terminal.workspaceStatusAfter
    },
    eventChain: {
      algorithm: "sha256(JSON.stringify(event))",
      events: events.length,
      finalHash,
      terminalEvent: terminalWithoutHash
    },
    artifacts: {
      transactionDiff: {
        algorithm: "sha256(JSON.stringify(diff))",
        sha256: diffSha256
      },
      transactionMetadata: {
        algorithm: CANONICAL_ALGORITHM,
        sha256: transactionSha256
      }
    },
    redaction: {
      filePathsIncluded: false,
      commandArgumentsIncluded: false,
      privatePathsIncluded: false,
      secrets: "redacted"
    },
    limitations: [
      "The workspace digest commits to Git HEAD, status, tracked diffs, and untracked content fingerprints; ignored files and external systems remain outside this proof.",
      "AgentTX is repository isolation, not an operating-system security boundary.",
      "This unsigned, recomputable integrity receipt is not authentication or proof against a party able to rewrite all local evidence."
    ]
  };
  return {
    receipt,
    integrity: {
      algorithm: "sha256",
      canonicalization: "agenttx-canonical-json-v1",
      scope: "receipt",
      authentication: "none",
      digest: canonicalSha256(receipt)
    }
  };
}

export function verifyRollbackEvidence(value: unknown): EvidenceVerification {
  const outer = record(value, "evidence artifact");
  exactKeys(outer, ["receipt", "integrity"], "evidence artifact");
  const receipt = record(outer.receipt, "receipt");
  const integrity = record(outer.integrity, "integrity");
  exactKeys(
    integrity,
    ["algorithm", "authentication", "canonicalization", "digest", "scope"],
    "integrity"
  );
  requireEqual(integrity.algorithm, "sha256", "integrity algorithm");
  requireEqual(integrity.canonicalization, "agenttx-canonical-json-v1", "canonicalization");
  requireEqual(integrity.scope, "receipt", "integrity scope");
  requireEqual(integrity.authentication, "none", "authentication");
  const outerDigest = digest(integrity.digest, "integrity digest");
  if (canonicalSha256(receipt) !== outerDigest) throw new Error("Evidence receipt digest mismatch.");

  exactKeys(
    receipt,
    [
      "artifacts",
      "eventChain",
      "evidenceType",
      "limitations",
      "producer",
      "redaction",
      "result",
      "schemaVersion",
      "transaction",
      "workspaceStatusEvidence"
    ],
    "receipt"
  );
  requireEqual(receipt.schemaVersion, 1, "receipt schemaVersion");
  requireEqual(receipt.evidenceType, "agenttx.rollback", "evidenceType");

  const producer = record(receipt.producer, "producer");
  exactKeys(producer, ["capability", "documentation", "repository", "version"], "producer");
  requireEqual(producer.repository, "aliengineering-byte/agenttx", "producer repository");
  requireEqual(producer.capability, "repository-transaction-rollback", "producer capability");
  requireEqual(
    producer.documentation,
    "https://github.com/aliengineering-byte/agenttx/blob/main/docs/SCHEMAS.md#rollback-evidence",
    "producer documentation"
  );
  if (typeof producer.version !== "string" || !SEMVER.test(producer.version)) {
    throw new Error("Invalid producer version.");
  }

  const transaction = record(receipt.transaction, "transaction");
  exactKeys(transaction, ["baseHead", "baselineCommit", "completedAt", "state", "transactionId"], "transaction");
  const transactionId = stringMatching(transaction.transactionId, TRANSACTION_ID, "transactionId");
  stringMatching(transaction.baselineCommit, GIT_OBJECT_ID, "baselineCommit");
  stringMatching(transaction.baseHead, GIT_OBJECT_ID, "baseHead");
  requireEqual(transaction.state, "ROLLED_BACK", "transaction state");
  assertIsoTimestamp(transaction.completedAt, "transaction completedAt");

  const result = record(receipt.result, "result");
  exactKeys(
    result,
    [
      "additionsDiscarded",
      "binaryFilesDiscarded",
      "deletionsDiscarded",
      "filesDiscarded",
      "originalWorkspaceStatusUnchanged"
    ],
    "result"
  );
  for (const field of ["filesDiscarded", "additionsDiscarded", "deletionsDiscarded", "binaryFilesDiscarded"]) {
    nonnegativeInteger(result[field], `result ${field}`);
  }

  const workspace = record(receipt.workspaceStatusEvidence, "workspaceStatusEvidence");
  exactKeys(workspace, ["after", "algorithm", "before"], "workspaceStatusEvidence");
  requireEqual(workspace.algorithm, WORKSPACE_ALGORITHM, "workspace algorithm");
  const before = digestOrNull(workspace.before, "workspace before digest");
  const after = digestOrNull(workspace.after, "workspace after digest");
  if (result.originalWorkspaceStatusUnchanged !== deriveWorkspaceStatusUnchanged(before, after)) {
    throw new Error("Workspace unchanged result is not derived from its before/after digests.");
  }

  const artifacts = record(receipt.artifacts, "artifacts");
  exactKeys(artifacts, ["transactionDiff", "transactionMetadata"], "artifacts");
  const transactionDiff = record(artifacts.transactionDiff, "transactionDiff");
  exactKeys(transactionDiff, ["algorithm", "sha256"], "transactionDiff");
  requireEqual(transactionDiff.algorithm, "sha256(JSON.stringify(diff))", "diff algorithm");
  const diffSha256 = digest(transactionDiff.sha256, "transaction diff digest");
  const transactionMetadata = record(artifacts.transactionMetadata, "transactionMetadata");
  exactKeys(transactionMetadata, ["algorithm", "sha256"], "transactionMetadata");
  requireEqual(transactionMetadata.algorithm, CANONICAL_ALGORITHM, "metadata algorithm");
  const transactionSha256 = digest(transactionMetadata.sha256, "transaction metadata digest");
  if (canonicalSha256(transaction) !== transactionSha256) {
    throw new Error("Transaction metadata digest mismatch.");
  }

  const eventChain = record(receipt.eventChain, "eventChain");
  exactKeys(eventChain, ["algorithm", "events", "finalHash", "terminalEvent"], "eventChain");
  requireEqual(eventChain.algorithm, "sha256(JSON.stringify(event))", "event algorithm");
  const events = positiveInteger(eventChain.events, "event count");
  const finalHash = digest(eventChain.finalHash, "final event hash");
  const terminal = record(eventChain.terminalEvent, "terminalEvent");
  exactKeys(terminal, ["data", "previousHash", "schemaVersion", "seq", "timestamp", "type"], "terminalEvent");
  requireEqual(terminal.schemaVersion, 1, "terminal event schemaVersion");
  const sequence = positiveInteger(terminal.seq, "terminal event sequence");
  if (sequence !== events) throw new Error("Terminal event sequence does not match event count.");
  requireEqual(terminal.type, "rollback.completed", "terminal event type");
  assertIsoTimestamp(terminal.timestamp, "terminal event timestamp");
  const previousHash = digestOrNull(terminal.previousHash, "terminal previous hash");
  if ((sequence === 1) !== (previousHash === null)) {
    throw new Error("Terminal previous hash is inconsistent with its sequence.");
  }
  const terminalData = record(terminal.data, "terminal event data");
  exactKeys(
    terminalData,
    ["diffSha256", "filesDiscarded", "transactionSha256", "workspaceStatusAfter", "workspaceStatusBefore"],
    "terminal event data"
  );
  if (nonnegativeInteger(terminalData.filesDiscarded, "terminal filesDiscarded") !== result.filesDiscarded) {
    throw new Error("Terminal discarded-file count does not match the receipt.");
  }
  if (digest(terminalData.diffSha256, "terminal diff digest") !== diffSha256) {
    throw new Error("Terminal diff digest does not match the receipt.");
  }
  if (digest(terminalData.transactionSha256, "terminal metadata digest") !== transactionSha256) {
    throw new Error("Terminal metadata digest does not match the receipt.");
  }
  if (
    digestOrNull(terminalData.workspaceStatusBefore, "terminal workspace before") !== before ||
    digestOrNull(terminalData.workspaceStatusAfter, "terminal workspace after") !== after
  ) {
    throw new Error("Terminal workspace digests do not match the receipt.");
  }
  const eventWithoutHash: Omit<TransactionEvent, "hash"> = {
    schemaVersion: 1,
    seq: sequence,
    type: "rollback.completed",
    timestamp: terminal.timestamp as string,
    data: {
      filesDiscarded: result.filesDiscarded,
      diffSha256,
      transactionSha256,
      workspaceStatusBefore: before,
      workspaceStatusAfter: after
    },
    previousHash
  };
  if (eventDigest(eventWithoutHash) !== finalHash) throw new Error("Terminal event digest mismatch.");

  const redaction = record(receipt.redaction, "redaction");
  exactKeys(redaction, ["commandArgumentsIncluded", "filePathsIncluded", "privatePathsIncluded", "secrets"], "redaction");
  requireEqual(redaction.filePathsIncluded, false, "filePathsIncluded");
  requireEqual(redaction.commandArgumentsIncluded, false, "commandArgumentsIncluded");
  requireEqual(redaction.privatePathsIncluded, false, "privatePathsIncluded");
  requireEqual(redaction.secrets, "redacted", "secret redaction");
  if (
    !Array.isArray(receipt.limitations) ||
    receipt.limitations.length < 3 ||
    receipt.limitations.some((item) => typeof item !== "string" || !item)
  ) {
    throw new Error("Evidence limitations are incomplete.");
  }
  if (!receipt.limitations.some((item) => (item as string).includes("unsigned, recomputable"))) {
    throw new Error("Evidence must disclose its unsigned, recomputable integrity limitation.");
  }

  return {
    valid: true,
    evidenceType: "agenttx.rollback",
    transactionId,
    digest: outerDigest,
    authentication: "none"
  };
}

export async function verifyRollbackEvidenceFile(path: string): Promise<EvidenceVerification> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`Cannot read evidence file: ${(error as Error).message}`);
  }
  return verifyRollbackEvidence(value);
}

export async function writeRollbackEvidence(
  metadata: TransactionMetadata,
  outputPath?: string
): Promise<string> {
  const destination = resolve(outputPath ?? join(metadata.transactionDirectory, "rollback-evidence.json"));
  const contents = `${JSON.stringify(await buildRollbackEvidence(metadata), null, 2)}\n`;
  try {
    const existing = await readFile(destination, "utf8");
    if (existing === contents) return destination;
    throw new Error(`Refusing to overwrite different rollback evidence: ${destination}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, destination);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(destination, "utf8");
    if (existing !== contents) {
      throw new Error(`Refusing to overwrite different rollback evidence: ${destination}`);
    }
  } finally {
    await rm(temporary, { force: true });
  }
  return destination;
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}.`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Unexpected fields in ${name}.`);
  }
}

function requireEqual(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`Invalid ${name}.`);
}

function stringMatching(value: unknown, pattern: RegExp, name: string): string {
  if (typeof value !== "string" || !pattern.test(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && SHA256.test(value);
}

function digest(value: unknown, name: string): string {
  if (!isDigest(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function isDigestOrNull(value: unknown): value is string | null {
  return value === null || isDigest(value);
}

function digestOrNull(value: unknown, name: string): string | null {
  if (!isDigestOrNull(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nonnegativeInteger(value: unknown, name: string): number {
  if (!isNonnegativeInteger(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  const integer = nonnegativeInteger(value, name);
  if (integer === 0) throw new Error(`Invalid ${name}.`);
  return integer;
}

function assertIsoTimestamp(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`Invalid ${name}.`);
  }
}
