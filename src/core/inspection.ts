import { join } from "node:path";
import { EventLedger } from "./ledger.js";
import { detectSecretFiles } from "../detectors/secrets.js";
import { assessRisk } from "./risk.js";
import { readVerification } from "./verification.js";
import { inspectDiff } from "./workspace.js";
import { SCHEMA_VERSION, type SecretFinding, type SideEffectFinding, type TransactionInspection, type TransactionMetadata } from "./types.js";
import { writeJsonAtomic } from "./fs.js";

function isSideEffect(value: unknown): value is SideEffectFinding {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SideEffectFinding>;
  return typeof item.category === "string" && typeof item.reason === "string" && typeof item.evidence === "string";
}

function isSecret(value: unknown): value is SecretFinding {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SecretFinding>;
  return typeof item.category === "string" && typeof item.reason === "string" && item.value === "[REDACTED]";
}

export async function inspectTransaction(metadata: TransactionMetadata): Promise<TransactionInspection> {
  const [diff, events, verification] = await Promise.all([
    inspectDiff(metadata),
    new EventLedger(metadata.transactionDirectory).read(),
    readVerification(metadata)
  ]);
  const sideEffects: SideEffectFinding[] = [];
  const secrets = detectSecretFiles(diff.files);
  for (const event of events) {
    const finding = event.data.finding;
    if ((event.type === "side_effect.blocked" || event.type === "side_effect.allowed") && isSideEffect(finding)) {
      sideEffects.push(finding);
    }
    if (event.type === "secret.path_referenced" && isSecret(finding)) secrets.push(finding);
  }
  const risk = assessRisk(diff, sideEffects, secrets);
  await writeJsonAtomic(join(metadata.transactionDirectory, "risk.json"), risk);
  return {
    schemaVersion: SCHEMA_VERSION,
    metadata,
    diff,
    sideEffects,
    secrets,
    risk,
    verification,
    eventCount: events.length,
    commandCount: events.filter((event) => event.type === "process.started" || event.type === "command.observed").length
  };
}
