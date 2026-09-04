import type {
  ChangeKind,
  CommandSpec,
  TransactionState,
  VerificationCheck
} from "../core/types.js";

export const PROOF_SCHEMA_VERSION = "agenttx.proof.v1" as const;
export const PROOF_CANONICALIZATION = "agenttx-canonical-json-v1" as const;

export type ProofVerdict = "PASS" | "REJECTED" | "ROLLED_BACK";
export type ProofPrivacy = "paths" | "minimal";
export type ProofTerminationReason =
  | "exit"
  | "signal"
  | "timeout"
  | "output-limit"
  | "spawn-error"
  | "policy-block";

export interface ProofOutputMetadata {
  stdoutBytes: number;
  stderrBytes: number;
  stdoutSha256: string;
  stderrSha256: string;
  truncated: boolean;
  preview: string[];
}

export interface ProofExecution {
  command: CommandSpec;
  exitCode: number;
  signal: NodeJS.Signals | null;
  terminationReason: ProofTerminationReason;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  shell: boolean;
  externalSideEffectsAuthorized: boolean;
  output: ProofOutputMetadata;
}

export interface ProofValidatorConfig {
  id: string;
  argv: string[];
  required: boolean;
  timeoutMs?: number;
  shell?: boolean;
}

export interface ProofRelatedEvidenceConfig {
  producer: string;
  version: string;
  capability: string;
  path: string;
  verify: string[];
  required?: boolean;
}

export interface ProofConfig {
  validators?: ProofValidatorConfig[];
  relatedEvidence?: ProofRelatedEvidenceConfig[];
}

export interface ProofOptions {
  command: CommandSpec;
  outputDirectory?: string;
  configPath?: string;
  validators: ProofValidatorConfig[];
  relatedEvidence: ProofRelatedEvidenceConfig[];
  privacy: ProofPrivacy;
  timeoutMs: number;
  maxOutputBytes: number;
  maxEvidenceBytes: number;
  shell: boolean;
  allowExternal: boolean;
  commitOnSuccess: boolean;
  rollbackOnFailure: boolean;
  dryRun: boolean;
}

export interface ProofRelatedEvidence {
  producer: string;
  producerVersion: string;
  capability: string;
  artifactPath: string;
  artifactSha256: string;
  verificationCommand: CommandSpec;
  verificationStatus: "passed" | "failed" | "missing";
  required: boolean;
}

export interface ProofReceipt {
  schemaVersion: typeof PROOF_SCHEMA_VERSION;
  agenttxVersion: string;
  producer: {
    repository: "https://github.com/aliengineering-byte/agenttx";
    capability: "proof-carrying-repository-transaction";
  };
  repository: {
    source: string | null;
    baseCommit: string;
    beforeStateSha256: string;
    afterStateSha256: string;
  };
  transaction: {
    id: string;
    state: TransactionState;
    accepted: boolean;
    verdict: ProofVerdict;
    reason: string;
    commitApplied: boolean;
    rollbackCompleted: boolean;
    unrelatedWorkspacePreserved: boolean | null;
  };
  execution: ProofExecution;
  bounds: {
    timeoutMs: number;
    maxOutputBytes: number;
    maxEvidenceBytes: number;
    maxNesting: 1;
  };
  changes: {
    filesChanged: number;
    additions: number;
    deletions: number;
    binaryFiles: number;
    pathsIncluded: boolean;
    files: Array<{ path?: string; oldPath?: string; kind: ChangeKind }>;
  };
  validators: Array<VerificationCheck & { required: boolean }>;
  relatedEvidence: ProofRelatedEvidence[];
  claims: {
    commandSucceeded: boolean;
    requiredValidatorsPassed: boolean;
    requiredEvidenceVerified: boolean;
    derivedVerdict: true;
  };
  timestamps: {
    startedAt: string;
    completedAt: string;
  };
  privacy: {
    mode: ProofPrivacy;
    environmentCaptured: false;
    promptsCaptured: false;
    secrets: "redacted";
  };
  reproduction: {
    argv: string[];
    workingDirectory: "repository-root";
    note: string;
  };
  verificationCommand: "agenttx verify-proof proof.json";
  limitations: string[];
}

export interface ProofArtifact {
  proof: ProofReceipt;
  integrity: {
    algorithm: "sha256";
    canonicalization: typeof PROOF_CANONICALIZATION;
    scope: "proof";
    authentication: "none";
    digest: string;
  };
}

export interface ProofVerification {
  valid: true;
  verdict: ProofVerdict;
  transactionId: string;
  digest: string;
  relatedEvidenceVerified: number;
  proofCardVerified: boolean;
  reproductionVerified: boolean;
  authentication: "none";
}
