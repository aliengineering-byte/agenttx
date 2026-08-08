export const SCHEMA_VERSION = 1 as const;

export const TRANSACTION_STATES = [
  "CREATED",
  "RUNNING",
  "REVIEW",
  "COMMITTED",
  "ROLLED_BACK",
  "FAILED",
  "ABORTED"
] as const;

export type TransactionState = (typeof TRANSACTION_STATES)[number];
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type ChangeKind = "added" | "modified" | "deleted" | "renamed";

export interface FileFingerprint {
  type: "file" | "symlink";
  sha256: string;
  size: number;
  mode: number;
}

export interface BeforeSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  capturedAt: string;
  head: string;
  status: string[];
  files: Record<string, FileFingerprint>;
}

export interface FileChange {
  path: string;
  kind: ChangeKind;
  oldPath?: string;
  additions: number | null;
  deletions: number | null;
  binary: boolean;
}

export interface DiffSummary {
  filesChanged: number;
  additions: number;
  deletions: number;
  binaryFiles: number;
  files: FileChange[];
}

export interface CommandSpec {
  command: string;
  args: string[];
}

export interface AgentCapabilities {
  structuredEvents: boolean;
  commandObservation: "top-level" | "path-shim";
}

export interface TransactionMetadata {
  schemaVersion: typeof SCHEMA_VERSION;
  transactionId: string;
  createdAt: string;
  updatedAt: string;
  workspace: string;
  repositoryRoot: string;
  transactionDirectory: string;
  worktree: string;
  invocationDirectory: string;
  baselineCommit: string;
  baseHead: string;
  agent: string;
  command: CommandSpec;
  status: TransactionState;
  allowExternal: boolean;
  parentPid: number;
  childPid?: number | undefined;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  interrupted?: boolean;
  failure?: string;
  cleanupWarning?: string;
}

export interface TransactionEvent<T = Record<string, unknown>> {
  schemaVersion: typeof SCHEMA_VERSION;
  seq: number;
  type: string;
  timestamp: string;
  data: T;
  previousHash: string | null;
  hash: string;
}

export interface SideEffectFinding {
  category:
    | "external_write"
    | "destructive"
    | "publish"
    | "deploy"
    | "remote_access";
  severity: "medium" | "high" | "critical";
  confidence: number;
  reason: string;
  evidence: string;
  blocked: boolean;
}

export interface SecretFinding {
  category: "secret_file_changed" | "secret_pattern_redacted";
  severity: "high";
  path?: string;
  reason: string;
  value: "[REDACTED]";
}

export interface RiskReason {
  points: number;
  reason: string;
}

export interface RiskAssessment {
  schemaVersion: typeof SCHEMA_VERSION;
  score: number;
  level: RiskLevel;
  reasons: RiskReason[];
}

export interface VerificationCheck {
  id: string;
  command: string;
  args: string[];
  source: string;
  status: "detected" | "passed" | "failed" | "skipped";
  exitCode?: number | null;
  durationMs?: number;
}

export interface VerificationReport {
  schemaVersion: typeof SCHEMA_VERSION;
  updatedAt: string;
  checks: VerificationCheck[];
}

export interface TransactionInspection {
  schemaVersion: typeof SCHEMA_VERSION;
  metadata: TransactionMetadata;
  diff: DiffSummary;
  sideEffects: SideEffectFinding[];
  secrets: SecretFinding[];
  risk: RiskAssessment;
  verification: VerificationReport;
  eventCount: number;
  commandCount: number;
}
