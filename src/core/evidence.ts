import { createHash } from "node:crypto";
import { link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { VERSION } from "../version.js";
import { EventLedger } from "./ledger.js";
import type { DiffSummary, RollbackEvidence, TransactionEvent, TransactionMetadata } from "./types.js";

interface RollbackCompletedData {
  filesDiscarded: number;
  workspaceStatusBefore: string | null;
  workspaceStatusAfter: string | null;
  originalWorkspaceStatusUnchanged: boolean | null;
  diffSha256: string;
}

function rollbackCompletedData(event: TransactionEvent | undefined): RollbackCompletedData {
  if (!event || event.type !== "rollback.completed") {
    throw new Error("Transaction ledger has no terminal rollback event.");
  }
  const data = event.data as Partial<RollbackCompletedData>;
  const validDigest = (value: unknown): value is string | null =>
    value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
  const validUnchanged =
    data.originalWorkspaceStatusUnchanged === true ||
    data.originalWorkspaceStatusUnchanged === false ||
    data.originalWorkspaceStatusUnchanged === null;
  if (
    typeof data.filesDiscarded !== "number" ||
    !validDigest(data.workspaceStatusBefore) ||
    !validDigest(data.workspaceStatusAfter) ||
    !validDigest(data.diffSha256) ||
    data.diffSha256 === null ||
    !validUnchanged
  ) {
    throw new Error("Terminal rollback event is missing workspace-status evidence.");
  }
  return data as RollbackCompletedData;
}

export async function buildRollbackEvidence(metadata: TransactionMetadata): Promise<RollbackEvidence> {
  if (metadata.status !== "ROLLED_BACK" || !metadata.completedAt) {
    throw new Error(`Transaction ${metadata.transactionId} is not a completed rollback.`);
  }
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
  if (terminal.diffSha256 !== diffSha256 || terminal.filesDiscarded !== diff.filesChanged) {
    throw new Error("Transaction diff does not match the terminal rollback event.");
  }
  return {
    schemaVersion: 1,
    evidenceType: "agenttx.rollback",
    producer: {
      repository: "aliengineering-byte/agenttx",
      version: VERSION,
      capability: "repository-transaction-rollback",
      documentation: "https://github.com/aliengineering-byte/agenttx/blob/main/docs/SCHEMAS.md#rollback-evidence"
    },
    transaction: {
      transactionId: metadata.transactionId,
      baselineCommit: metadata.baselineCommit,
      baseHead: metadata.baseHead,
      state: "ROLLED_BACK",
      completedAt: metadata.completedAt
    },
    result: {
      filesDiscarded: diff.filesChanged,
      additionsDiscarded: diff.additions,
      deletionsDiscarded: diff.deletions,
      binaryFilesDiscarded: diff.binaryFiles,
      originalWorkspaceStatusUnchanged: terminal.originalWorkspaceStatusUnchanged
    },
    workspaceStatusEvidence: {
      algorithm: "sha256(git-head-nul-status-porcelain-v2-z)",
      before: terminal.workspaceStatusBefore,
      after: terminal.workspaceStatusAfter
    },
    eventChain: {
      algorithm: "sha256",
      events: events.length,
      finalHash: terminalEvent.hash
    },
    artifacts: {
      transactionDiff: {
        algorithm: "sha256(JSON.stringify(diff))",
        sha256: diffSha256
      }
    },
    redaction: {
      filePathsIncluded: false,
      commandArgumentsIncluded: false,
      privatePathsIncluded: false,
      secrets: "redacted"
    },
    limitations: [
      "The workspace digest covers Git HEAD and Git-visible tracked/untracked status; ignored files and external systems are outside this proof.",
      "AgentTX is repository isolation, not an operating-system security boundary."
    ]
  };
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
