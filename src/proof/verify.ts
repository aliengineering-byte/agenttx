import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { canonicalSha256 } from "../core/evidence.js";
import { assertContained, assertSafeRelativePath } from "../core/fs.js";
import { renderProofCard, renderReproduction } from "./render.js";
import {
  PROOF_CANONICALIZATION,
  PROOF_SCHEMA_VERSION,
  type ProofArtifact,
  type ProofReceipt,
  type ProofVerification
} from "./types.js";

const SHA256 = /^[a-f0-9]{64}$/;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid ${name}.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new Error(`Invalid ${name}.`);
  return value;
}

function digest(value: unknown, name: string): string {
  const result = string(value, name);
  if (!SHA256.test(result)) throw new Error(`Invalid ${name}.`);
  return result;
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`Invalid ${name}.`);
  return value as number;
}

function verifySemantics(proof: ProofReceipt): void {
  if (proof.schemaVersion !== PROOF_SCHEMA_VERSION) throw new Error("Unsupported proof schema version.");
  const commandSucceeded =
    proof.execution.exitCode === 0 && proof.execution.terminationReason === "exit";
  const validatorsPassed = proof.validators
    .filter((item) => item.required)
    .every((item) => item.status === "passed");
  const evidencePassed = proof.relatedEvidence
    .filter((item) => item.required)
    .every((item) => item.verificationStatus === "passed");
  if (proof.claims.commandSucceeded !== commandSucceeded) throw new Error("Command success claim is not derived.");
  if (proof.claims.requiredValidatorsPassed !== validatorsPassed) {
    throw new Error("Validator success claim is not derived.");
  }
  if (proof.claims.requiredEvidenceVerified !== evidencePassed) {
    throw new Error("Related-evidence claim is not derived.");
  }
  const accepted = commandSucceeded && validatorsPassed && evidencePassed;
  if (proof.transaction.accepted !== accepted) throw new Error("Transaction acceptance is not derived.");
  if (proof.transaction.commitApplied !== (proof.transaction.state === "COMMITTED")) {
    throw new Error("Commit outcome does not match terminal state.");
  }
  if (proof.transaction.rollbackCompleted !== (proof.transaction.state === "ROLLED_BACK")) {
    throw new Error("Rollback outcome does not match terminal state.");
  }
  if (proof.transaction.verdict === "PASS") {
    if (!accepted || !["COMMITTED", "REVIEW"].includes(proof.transaction.state)) {
      throw new Error("PASS verdict is inconsistent with recorded outcomes.");
    }
  } else if (proof.transaction.verdict === "ROLLED_BACK") {
    if (!proof.transaction.rollbackCompleted) throw new Error("ROLLED_BACK verdict lacks a completed rollback.");
  } else if (proof.transaction.verdict === "REJECTED") {
    if (accepted || proof.transaction.rollbackCompleted) {
      throw new Error("REJECTED verdict is inconsistent with recorded outcomes.");
    }
  } else {
    throw new Error("Invalid proof verdict.");
  }
  integer(proof.bounds.timeoutMs, "timeout bound", 100);
  integer(proof.bounds.maxOutputBytes, "output bound", 1024);
  integer(proof.bounds.maxEvidenceBytes, "evidence bound", 1024);
  if (proof.bounds.maxNesting !== 1) throw new Error("Invalid nesting bound.");
  if (proof.execution.output.stdoutBytes + proof.execution.output.stderrBytes > proof.bounds.maxOutputBytes) {
    throw new Error("Recorded output exceeds its declared bound.");
  }
  if (proof.changes.files.length > proof.changes.filesChanged) {
    throw new Error("Changed-path list exceeds the recorded file count.");
  }
  for (const file of proof.changes.files) {
    if (file.path) assertSafeRelativePath(file.path);
    if (file.oldPath) assertSafeRelativePath(file.oldPath);
  }
  if (proof.privacy.environmentCaptured !== false || proof.privacy.promptsCaptured !== false) {
    throw new Error("Proof violates the no-environment/no-prompt schema guarantee.");
  }
  if (typeof proof.execution.externalSideEffectsAuthorized !== "boolean") {
    throw new Error("Proof does not declare external-side-effect authorization.");
  }
}

export function verifyProofArtifact(value: unknown): ProofVerification {
  const outer = record(value, "proof artifact");
  const proof = record(outer.proof, "proof receipt") as unknown as ProofReceipt;
  const integrity = record(outer.integrity, "proof integrity");
  if (integrity.algorithm !== "sha256") throw new Error("Unsupported proof digest algorithm.");
  if (integrity.canonicalization !== PROOF_CANONICALIZATION) throw new Error("Unsupported canonicalization.");
  if (integrity.scope !== "proof" || integrity.authentication !== "none") {
    throw new Error("Invalid proof integrity declaration.");
  }
  const expectedDigest = digest(integrity.digest, "proof digest");
  if (canonicalSha256(proof) !== expectedDigest) throw new Error("Proof receipt digest mismatch.");
  verifySemantics(proof);
  return {
    valid: true,
    verdict: proof.transaction.verdict,
    transactionId: string(proof.transaction.id, "transaction ID"),
    digest: expectedDigest,
    relatedEvidenceVerified: proof.relatedEvidence.filter((item) => item.verificationStatus === "passed").length,
    proofCardVerified: false,
    reproductionVerified: false,
    authentication: "none"
  };
}

export async function verifyProofFile(path: string): Promise<ProofVerification> {
  const proofPath = resolve(path);
  const bytes = await readFile(proofPath);
  if (bytes.length > 16 * 1024 * 1024) throw new Error("Proof JSON exceeds the verifier input bound.");
  let artifact: ProofArtifact;
  try {
    artifact = JSON.parse(bytes.toString("utf8")) as ProofArtifact;
  } catch (error) {
    throw new Error(`Cannot parse proof JSON: ${(error as Error).message}`);
  }
  const verification = verifyProofArtifact(artifact);
  const root = dirname(proofPath);
  let relatedBytes = 0;
  for (const related of artifact.proof.relatedEvidence) {
    assertSafeRelativePath(related.artifactPath);
    const artifactPath = resolve(root, related.artifactPath);
    assertContained(root, artifactPath);
    const content = await readFile(artifactPath);
    relatedBytes += content.length;
    if (relatedBytes > artifact.proof.bounds.maxEvidenceBytes) {
      throw new Error("Related evidence exceeds the declared evidence bound.");
    }
    const actual = createHash("sha256").update(content).digest("hex");
    if (actual !== digest(related.artifactSha256, "related evidence digest")) {
      throw new Error(`Related evidence digest mismatch: ${related.artifactPath}`);
    }
  }
  const expectedHtml = renderProofCard(artifact);
  const expectedReproduction = renderReproduction(artifact.proof);
  const [actualHtml, actualReproduction] = await Promise.all([
    readFile(resolve(root, "proof.html"), "utf8"),
    readFile(resolve(root, "reproduce.md"), "utf8")
  ]);
  if (actualHtml !== expectedHtml) throw new Error("Proof Card does not match proof.json.");
  if (actualReproduction !== expectedReproduction) throw new Error("Reproduction record does not match proof.json.");
  return { ...verification, proofCardVerified: true, reproductionVerified: true };
}
