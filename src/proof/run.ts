import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalSha256 } from "../core/evidence.js";
import { assertContained, assertSafeRelativePath, pathExists, toPosixPath } from "../core/fs.js";
import { runGit } from "../core/git.js";
import { inspectTransaction } from "../core/inspection.js";
import { sanitizeCommand } from "../core/redaction.js";
import { runTransaction } from "../core/runner.js";
import type { VerificationCheck } from "../core/types.js";
import { commitTransaction, createTransaction, rollbackTransaction } from "../core/workspace.js";
import { VERSION } from "../version.js";
import { runGate } from "./process.js";
import { renderProofCard, renderReproduction } from "./render.js";
import {
  PROOF_CANONICALIZATION,
  PROOF_SCHEMA_VERSION,
  type ProofArtifact,
  type ProofOptions,
  type ProofReceipt,
  type ProofRelatedEvidence,
  type ProofVerification
} from "./types.js";
import { verifyProofFile } from "./verify.js";

interface BufferedEvidence {
  receipt: ProofRelatedEvidence;
  content: Buffer;
}

export interface ProofRunResult {
  artifact: ProofArtifact;
  outputDirectory: string;
  proofPath: string;
  cardPath: string;
  reproductionPath: string;
  verification: ProofVerification;
}

async function reserveOutputDirectory(path: string): Promise<void> {
  if (await pathExists(path)) throw new Error(`Refusing to overwrite existing proof output: ${path}`);
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path);
}

async function repositorySource(repositoryRoot: string): Promise<string | null> {
  const result = await runGit(repositoryRoot, ["remote", "get-url", "origin"], { allowFailure: true });
  const value = result.stdout.trim();
  if (!value) return null;
  return value.replace(/^(https?:\/\/)[^/@:]+:[^/@]+@/i, "$1[REDACTED]:[REDACTED]@");
}

async function runValidators(
  worktree: string,
  validators: ProofOptions["validators"],
  canRun: boolean,
  maxOutputBytes: number,
  defaultTimeoutMs: number
): Promise<Array<VerificationCheck & { required: boolean }>> {
  const results: Array<VerificationCheck & { required: boolean }> = [];
  for (const validator of validators) {
    const [command, ...args] = validator.argv;
    if (!command || !canRun) {
      results.push({
        id: validator.id,
        command: command ?? "",
        args,
        source: "AgentTX proof configuration",
        status: "skipped",
        required: validator.required
      });
      continue;
    }
    const result = await runGate(validator.argv, {
      cwd: worktree,
      timeoutMs: validator.timeoutMs ?? defaultTimeoutMs,
      maxOutputBytes,
      shell: validator.shell ?? false
    });
    const safe = sanitizeCommand(command, args);
    results.push({
      id: validator.id,
      command: safe.command,
      args: safe.args,
      source: "AgentTX proof configuration",
      status: result.exitCode === 0 && result.terminationReason === "exit" ? "passed" : "failed",
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      required: validator.required
    });
  }
  return results;
}

async function collectRelatedEvidence(
  worktree: string,
  related: ProofOptions["relatedEvidence"],
  maxEvidenceBytes: number,
  maxOutputBytes: number,
  timeoutMs: number
): Promise<BufferedEvidence[]> {
  const results: BufferedEvidence[] = [];
  let total = 0;
  for (let index = 0; index < related.length; index += 1) {
    const item = related[index];
    if (!item) continue;
    assertSafeRelativePath(item.path);
    const source = resolve(worktree, item.path);
    assertContained(worktree, source);
    const required = item.required ?? true;
    let content = Buffer.alloc(0);
    let status: ProofRelatedEvidence["verificationStatus"] = "missing";
    if (await pathExists(source)) {
      content = await readFile(source);
      total += content.length;
      if (total > maxEvidenceBytes) {
        content = Buffer.alloc(0);
        status = "failed";
      } else {
        const actualArgv = item.verify.includes("{evidence}")
          ? item.verify.map((arg) => arg === "{evidence}" ? source : arg)
          : [...item.verify, source];
        const verification = await runGate(actualArgv, {
          cwd: worktree,
          timeoutMs,
          maxOutputBytes,
          shell: false
        });
        status = verification.exitCode === 0 && verification.terminationReason === "exit" ? "passed" : "failed";
      }
    }
    const safeVerify = sanitizeCommand(item.verify[0] ?? "", item.verify.slice(1));
    const safeName = basename(item.path).replace(/[^a-z0-9._-]/gi, "_") || "evidence.bin";
    results.push({
      content,
      receipt: {
        producer: item.producer,
        producerVersion: item.version,
        capability: item.capability,
        artifactPath: toPosixPath(join("related", `${String(index + 1).padStart(2, "0")}-${safeName}`)),
        artifactSha256: createHash("sha256").update(content).digest("hex"),
        verificationCommand: safeVerify,
        verificationStatus: status,
        required
      }
    });
  }
  return results;
}

function reasonFor(
  commandSucceeded: boolean,
  validatorsPassed: boolean,
  evidencePassed: boolean,
  commitError: string | null,
  rollbackError: string | null
): string {
  if (rollbackError) return "Required gates failed and rollback could not be completed; inspect the isolated transaction.";
  if (commitError) return "All required gates passed, but applying the accepted change failed; the isolated change was rolled back.";
  if (!commandSucceeded) return "The command did not complete successfully; its isolated changes were rejected.";
  if (!validatorsPassed) return "A required validator failed; the claimed success was rejected.";
  if (!evidencePassed) return "Required related evidence failed verification; the claimed success was rejected.";
  return "The command and every required gate passed; the change was accepted.";
}

export async function runProof(cwd: string, cliPath: string, options: ProofOptions): Promise<ProofRunResult> {
  if (process.env.AGENTTX_TRANSACTION_ID) {
    throw new Error("Nested AgentTX proof execution is refused (maximum nesting is 1).");
  }
  if (options.dryRun) throw new Error("runProof cannot execute a dry run.");
  if (options.shell && process.platform === "win32" && options.command.command !== "cmd.exe") {
    throw new Error("On Windows, explicit shell mode requires cmd.exe as the command so argv boundaries remain visible.");
  }
  const requestedOutput = options.outputDirectory ? resolve(cwd, options.outputDirectory) : undefined;
  if (requestedOutput && await pathExists(requestedOutput)) {
    throw new Error(`Refusing to overwrite existing proof output: ${requestedOutput}`);
  }
  const metadata = await createTransaction(cwd, options.command, {
    allowExternal: options.allowExternal,
    agent: "proof-command"
  });
  const outputDirectory = requestedOutput ?? join(metadata.transactionDirectory, "proof");
  try {
    await reserveOutputDirectory(outputDirectory);
  } catch (error) {
    await rollbackTransaction(metadata);
    throw error;
  }
  const before = JSON.parse(await readFile(join(metadata.transactionDirectory, "before.json"), "utf8")) as unknown;
  const source = await repositorySource(metadata.repositoryRoot);
  const run = await runTransaction(metadata, cliPath, options.command, {
    captureOutput: true,
    maxOutputBytes: options.maxOutputBytes,
    timeoutMs: options.timeoutMs,
    shell: options.shell
  });
  const inspection = await inspectTransaction(run.metadata);
  const commandSucceeded = run.exitCode === 0 && run.execution.terminationReason === "exit";
  const validators = await runValidators(
    run.metadata.worktree,
    options.validators,
    commandSucceeded,
    options.maxOutputBytes,
    options.timeoutMs
  );
  const validatorsPassed = validators.filter((item) => item.required).every((item) => item.status === "passed");
  const related = await collectRelatedEvidence(
    run.metadata.worktree,
    options.relatedEvidence,
    options.maxEvidenceBytes,
    options.maxOutputBytes,
    options.timeoutMs
  );
  const evidencePassed = related.filter((item) => item.receipt.required)
    .every((item) => item.receipt.verificationStatus === "passed");
  const accepted = commandSucceeded && validatorsPassed && evidencePassed;
  let finalMetadata = run.metadata;
  let commitApplied = false;
  let rollbackCompleted = false;
  let unrelatedWorkspacePreserved: boolean | null = null;
  let commitError: string | null = null;
  let rollbackError: string | null = null;
  if (accepted && options.commitOnSuccess) {
    try {
      finalMetadata = (await commitTransaction(run.metadata)).metadata;
      commitApplied = true;
    } catch (error) {
      commitError = (error as Error).message;
      if (options.rollbackOnFailure) {
        try {
          const rolledBack = await rollbackTransaction(run.metadata);
          finalMetadata = rolledBack.metadata;
          rollbackCompleted = true;
          unrelatedWorkspacePreserved = rolledBack.originalWorkspaceStatusUnchanged;
        } catch (rollbackFailure) {
          rollbackError = (rollbackFailure as Error).message;
        }
      }
    }
  } else if (!accepted && options.rollbackOnFailure) {
    try {
      const rolledBack = await rollbackTransaction(run.metadata);
      finalMetadata = rolledBack.metadata;
      rollbackCompleted = true;
      unrelatedWorkspacePreserved = rolledBack.originalWorkspaceStatusUnchanged;
    } catch (error) {
      rollbackError = (error as Error).message;
    }
  }
  const verdict = rollbackCompleted ? "ROLLED_BACK" : accepted && !commitError ? "PASS" : "REJECTED";
  const safeCommand = sanitizeCommand(options.command.command, options.command.args);
  const pathsIncluded = options.privacy === "paths";
  const completedAt = finalMetadata.completedAt ?? new Date().toISOString();
  const receipt: ProofReceipt = {
    schemaVersion: PROOF_SCHEMA_VERSION,
    agenttxVersion: VERSION,
    producer: {
      repository: "https://github.com/aliengineering-byte/agenttx",
      capability: "proof-carrying-repository-transaction"
    },
    repository: {
      source,
      baseCommit: metadata.baseHead,
      beforeStateSha256: canonicalSha256(before),
      afterStateSha256: canonicalSha256({ baseCommit: metadata.baseHead, diff: inspection.diff })
    },
    transaction: {
      id: metadata.transactionId,
      state: finalMetadata.status,
      accepted,
      verdict,
      reason: reasonFor(commandSucceeded, validatorsPassed, evidencePassed, commitError, rollbackError),
      commitApplied,
      rollbackCompleted,
      unrelatedWorkspacePreserved
    },
    execution: {
      command: safeCommand,
      exitCode: run.exitCode,
      signal: run.signal,
      terminationReason: run.execution.terminationReason,
      startedAt: run.execution.startedAt,
      completedAt: run.execution.completedAt,
      durationMs: run.execution.durationMs,
      shell: options.shell,
      externalSideEffectsAuthorized: options.allowExternal,
      output: options.privacy === "minimal"
        ? { ...run.execution.output, preview: [] }
        : run.execution.output
    },
    bounds: {
      timeoutMs: options.timeoutMs,
      maxOutputBytes: options.maxOutputBytes,
      maxEvidenceBytes: options.maxEvidenceBytes,
      maxNesting: 1
    },
    changes: {
      filesChanged: inspection.diff.filesChanged,
      additions: inspection.diff.additions,
      deletions: inspection.diff.deletions,
      binaryFiles: inspection.diff.binaryFiles,
      pathsIncluded,
      files: inspection.diff.files.map((file) => ({
        ...(pathsIncluded ? { path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}) } : {}),
        kind: file.kind
      }))
    },
    validators,
    relatedEvidence: related.map((item) => item.receipt),
    claims: {
      commandSucceeded,
      requiredValidatorsPassed: validatorsPassed,
      requiredEvidenceVerified: evidencePassed,
      derivedVerdict: true
    },
    timestamps: { startedAt: run.execution.startedAt, completedAt },
    privacy: {
      mode: options.privacy,
      environmentCaptured: false,
      promptsCaptured: false,
      secrets: "redacted"
    },
    reproduction: {
      argv: [safeCommand.command, ...safeCommand.args],
      workingDirectory: "repository-root",
      note: "Arguments containing recognized credentials are redacted and must be supplied again locally. External side effects are outside the rollback guarantee."
    },
    verificationCommand: "agenttx verify-proof proof.json",
    limitations: [
      "AgentTX isolates Git-visible repository changes; it is not an operating-system sandbox.",
      "Remote pushes, messages, API calls, database writes, and other external side effects cannot be rolled back by this receipt.",
      "Ignored files and unrelated external state are outside the recorded workspace-state digest.",
      "The receipt provides unsigned, recomputable integrity, not authentication of the producer."
    ]
  };
  const artifact: ProofArtifact = {
    proof: receipt,
    integrity: {
      algorithm: "sha256",
      canonicalization: PROOF_CANONICALIZATION,
      scope: "proof",
      authentication: "none",
      digest: canonicalSha256(receipt)
    }
  };
  const json = `${JSON.stringify(artifact, null, 2)}\n`;
  const card = renderProofCard(artifact);
  const reproduction = renderReproduction(receipt);
  const proofPath = join(outputDirectory, "proof.json");
  const cardPath = join(outputDirectory, "proof.html");
  const reproductionPath = join(outputDirectory, "reproduce.md");
  await mkdir(join(outputDirectory, "related"), { recursive: true });
  await Promise.all([
    writeFile(proofPath, json, { flag: "wx", mode: 0o600 }),
    writeFile(cardPath, card, { flag: "wx", mode: 0o600 }),
    writeFile(reproductionPath, reproduction, { flag: "wx", mode: 0o600 }),
    ...related.map((item) => writeFile(resolve(outputDirectory, item.receipt.artifactPath), item.content, { flag: "wx", mode: 0o600 }))
  ]);
  const verification = await verifyProofFile(proofPath);
  return { artifact, outputDirectory, proofPath, cardPath, reproductionPath, verification };
}
