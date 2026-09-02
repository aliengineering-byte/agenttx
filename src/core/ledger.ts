import { createHash } from "node:crypto";
import { appendFile, mkdir, open, readFile, rm, stat, truncate, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "./fs.js";
import { redactValue } from "./redaction.js";
import { SCHEMA_VERSION, type TransactionEvent } from "./types.js";

export function eventDigest(event: Omit<TransactionEvent, "hash">): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function acquireLock(path: string, timeoutMs = 5_000): Promise<() => Promise<void>> {
  const started = Date.now();
  await mkdir(dirname(path), { recursive: true });
  while (true) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      await handle.close();
      return async () => rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const lock = JSON.parse(await readFile(path, "utf8")) as { pid: number; createdAt: number };
        if (Date.now() - lock.createdAt > 10_000 || !isProcessRunning(lock.pid)) {
          await rm(path, { force: true });
          continue;
        }
      } catch {
        try {
          const lockStat = await stat(path);
          if (Date.now() - lockStat.mtimeMs > 10_000) await rm(path, { force: true });
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw statError;
        }
      }
      if (Date.now() - started >= timeoutMs) throw new Error("Timed out acquiring event ledger lock");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

export class EventLedger {
  readonly path: string;
  readonly lockPath: string;

  constructor(transactionDirectory: string) {
    this.path = join(transactionDirectory, "events.jsonl");
    this.lockPath = join(transactionDirectory, "events.lock");
  }

  async append(type: string, data: Record<string, unknown> = {}): Promise<TransactionEvent> {
    const release = await acquireLock(this.lockPath);
    try {
      await this.repairIncompleteTail();
      const events = await this.read();
      const previous = events.at(-1);
      const withoutHash: Omit<TransactionEvent, "hash"> = {
        schemaVersion: SCHEMA_VERSION,
        seq: (previous?.seq ?? 0) + 1,
        type,
        timestamp: new Date().toISOString(),
        data: redactValue(data) as Record<string, unknown>,
        previousHash: previous?.hash ?? null
      };
      const event: TransactionEvent = { ...withoutHash, hash: eventDigest(withoutHash) };
      await appendFile(this.path, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
      return event;
    } finally {
      await release();
    }
  }

  private async repairIncompleteTail(): Promise<void> {
    if (!(await pathExists(this.path))) return;
    const content = await readFile(this.path, "utf8");
    if (!content || content.endsWith("\n")) return;
    const lastNewline = content.lastIndexOf("\n");
    const tail = content.slice(lastNewline + 1);
    try {
      JSON.parse(tail);
      await appendFile(this.path, "\n", "utf8");
    } catch {
      await truncate(this.path, Buffer.byteLength(content.slice(0, lastNewline + 1)));
    }
  }

  async read(): Promise<TransactionEvent[]> {
    if (!(await pathExists(this.path))) return [];
    const content = await readFile(this.path, "utf8");
    const lines = content.split("\n");
    const events: TransactionEvent[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      let event: TransactionEvent;
      try {
        event = JSON.parse(line) as TransactionEvent;
      } catch (error) {
        const incompleteLastLine = index === lines.length - 1 && !content.endsWith("\n");
        if (incompleteLastLine) break;
        throw new Error(`Event ledger is corrupt at line ${index + 1}: ${(error as Error).message}`);
      }
      if (event.schemaVersion !== SCHEMA_VERSION) {
        throw new Error(`Unsupported event schema at line ${index + 1}`);
      }
      const expectedSequence = events.length + 1;
      if (event.seq !== expectedSequence) {
        throw new Error(`Event ledger sequence mismatch at line ${index + 1}`);
      }
      const previousHash = events.at(-1)?.hash ?? null;
      if (event.previousHash !== previousHash) {
        throw new Error(`Event ledger chain mismatch at line ${index + 1}`);
      }
      const { hash, ...withoutHash } = event;
      if (hash !== eventDigest(withoutHash)) {
        throw new Error(`Event ledger checksum mismatch at line ${index + 1}`);
      }
      events.push(event);
    }
    return events;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    if (!(await pathExists(this.path))) await writeFile(this.path, "", { mode: 0o600 });
  }
}
