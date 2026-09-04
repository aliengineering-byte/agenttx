#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveAdapter } from "./adapters/agent.js";
import { runDoctor, renderDoctor } from "./cli/doctor.js";
import { verifyRollbackEvidenceFile, writeRollbackEvidence } from "./core/evidence.js";
import { inspectTransaction } from "./core/inspection.js";
import { EventLedger } from "./core/ledger.js";
import { redactText, sanitizeCommand } from "./core/redaction.js";
import { runTransaction } from "./core/runner.js";
import { runShim } from "./core/shims.js";
import { listTransactions, resolveTransaction } from "./core/store.js";
import type { CommandSpec } from "./core/types.js";
import { readVerification, runVerification } from "./core/verification.js";
import {
  commitTransaction,
  createTransaction,
  recoverInterruptedTransactions,
  rollbackTransaction,
  transactionPatch
} from "./core/workspace.js";
import { generateHtmlReport } from "./reporters/html.js";
import {
  renderDiffSummary,
  renderHistory,
  renderStatus,
  renderTransactionReport,
  renderVerification
} from "./reporters/terminal.js";
import { VERSION } from "./version.js";
import { findRepository } from "./core/git.js";
import { pathExists } from "./core/fs.js";
import { loadProofConfig, validateArgv } from "./proof/config.js";
import { badgeSnippet, initializeGitHub } from "./proof/init.js";
import { renderProofCard } from "./proof/render.js";
import { runProof } from "./proof/run.js";
import type { ProofArtifact, ProofOptions, ProofPrivacy, ProofValidatorConfig } from "./proof/types.js";
import { verifyProofArtifact, verifyProofFile } from "./proof/verify.js";

const execFileAsync = promisify(execFile);
const cliPath = fileURLToPath(import.meta.url);
const packageRoot = resolve(dirname(cliPath), "..", "..");

function print(value = ""): void {
  process.stdout.write(`${value}\n`);
}

function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

function positional(args: readonly string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") {
      index += 1;
      continue;
    }
    if (arg && !arg.startsWith("--")) values.push(arg);
  }
  return values;
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function help(): string {
  return `AgentTX ${VERSION} — Make AI agents undoable.

Usage:
  agenttx run [--allow-external] [--] <command...>
  agenttx proof [options] -- <command...>
  agenttx verify-proof <proof.json>
  agenttx render-proof <proof.json> [--output proof.html]
  agenttx init --github [--badge owner/repository]
  agenttx feedback <proof.json>
  agenttx status [transaction-id] [--json]
  agenttx diff [transaction-id] [--stat|--full]
  agenttx inspect [transaction-id] [--json]
  agenttx verify [transaction-id] [--run]
  agenttx commit [transaction-id]
  agenttx rollback [transaction-id]
  agenttx history [--json]
  agenttx replay <transaction-id> [--json]
  agenttx evidence <transaction-id> [--output path]
  agenttx verify-evidence <file>
  agenttx report [transaction-id] --html [--output path]
  agenttx doctor [--json]
  agenttx demo [--keep]

External writes detected by top-level matching or PATH shims are blocked by default.
Detection is heuristic; AgentTX V0 is not an OS security sandbox.`;
}

interface ParsedProof {
  options: ProofOptions;
  json: boolean;
}

function boundedInteger(value: string | undefined, name: string, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function inlineValidator(value: string | undefined, required: boolean, index: number): ProofValidatorConfig {
  if (!value) throw new Error("Validator options require a JSON argv array.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Validator must be a JSON argv array, for example '[\"npm\",\"test\"]'.");
  }
  return { id: `${required ? "required" : "optional"}-${index}`, argv: validateArgv(parsed, "validator"), required };
}

async function parseProof(args: string[]): Promise<ParsedProof> {
  const separator = args.indexOf("--");
  if (separator < 0) throw new Error("agenttx proof requires -- before the command.");
  const flags = args.slice(0, separator);
  const argv = validateArgv(args.slice(separator + 1), "proof command");
  let configPath: string | undefined;
  let outputDirectory: string | undefined;
  let privacy: ProofPrivacy = "paths";
  let timeoutMs = 120_000;
  let maxOutputBytes = 1024 * 1024;
  let maxEvidenceBytes = 16 * 1024 * 1024;
  let shell = false;
  let allowExternal = false;
  let commitOnSuccess = true;
  let rollbackOnFailure = true;
  let dryRun = false;
  let json = false;
  const inline: ProofValidatorConfig[] = [];
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];
    if (flag === "--config") configPath = flags[++index];
    else if (flag === "--output" || flag === "--output-dir") outputDirectory = flags[++index];
    else if (flag === "--privacy") {
      const value = flags[++index];
      if (value !== "paths" && value !== "minimal") throw new Error("--privacy must be paths or minimal.");
      privacy = value;
    } else if (flag === "--timeout-ms") timeoutMs = boundedInteger(flags[++index], flag, 100, 3_600_000);
    else if (flag === "--max-output-bytes") maxOutputBytes = boundedInteger(flags[++index], flag, 1024, 64 * 1024 * 1024);
    else if (flag === "--max-evidence-bytes") maxEvidenceBytes = boundedInteger(flags[++index], flag, 1024, 256 * 1024 * 1024);
    else if (flag === "--validator") inline.push(inlineValidator(flags[++index], true, inline.length + 1));
    else if (flag === "--optional-validator") inline.push(inlineValidator(flags[++index], false, inline.length + 1));
    else if (flag === "--shell") shell = true;
    else if (flag === "--allow-external") allowExternal = true;
    else if (flag === "--no-commit") commitOnSuccess = false;
    else if (flag === "--no-rollback") rollbackOnFailure = false;
    else if (flag === "--dry-run") dryRun = true;
    else if (flag === "--json") json = true;
    else throw new Error(`Unknown proof option: ${flag}`);
  }
  const repositoryRoot = await findRepository(process.cwd());
  const config = await loadProofConfig(repositoryRoot, configPath);
  return {
    json,
    options: {
      command: { command: argv[0] as string, args: argv.slice(1) },
      ...(outputDirectory ? { outputDirectory } : {}),
      ...(configPath ? { configPath } : {}),
      validators: [...(config.validators ?? []), ...inline],
      relatedEvidence: config.relatedEvidence ?? [],
      privacy,
      timeoutMs,
      maxOutputBytes,
      maxEvidenceBytes,
      shell,
      allowExternal,
      commitOnSuccess,
      rollbackOnFailure,
      dryRun
    }
  };
}

async function handleProof(args: string[]): Promise<void> {
  const parsed = await parseProof(args);
  if (parsed.options.dryRun) {
    const plan = {
      valid: true,
      dryRun: true,
      command: sanitizeCommand(parsed.options.command.command, parsed.options.command.args),
      validators: parsed.options.validators,
      relatedEvidence: parsed.options.relatedEvidence,
      bounds: {
        timeoutMs: parsed.options.timeoutMs,
        maxOutputBytes: parsed.options.maxOutputBytes,
        maxEvidenceBytes: parsed.options.maxEvidenceBytes,
        maxNesting: 1
      },
      shell: parsed.options.shell,
      allowExternal: parsed.options.allowExternal,
      commitOnSuccess: parsed.options.commitOnSuccess,
      rollbackOnFailure: parsed.options.rollbackOnFailure
    };
    print(JSON.stringify(plan, null, parsed.json ? 0 : 2));
    return;
  }
  const result = await runProof(process.cwd(), cliPath, parsed.options);
  if (parsed.json) {
    print(JSON.stringify({
      verdict: result.artifact.proof.transaction.verdict,
      digest: result.artifact.integrity.digest,
      transactionState: result.artifact.proof.transaction.state,
      proofJson: result.proofPath,
      proofCard: result.cardPath,
      reproduction: result.reproductionPath
    }));
  } else {
    print(`${result.artifact.proof.transaction.verdict}: ${result.artifact.proof.transaction.reason}`);
    print(`Proof JSON: ${result.proofPath}`);
    print(`Proof Card: ${result.cardPath}`);
    print(`Digest: ${result.artifact.integrity.digest}`);
    print(`Verify: agenttx verify-proof "${result.proofPath}"`);
  }
  if (result.artifact.proof.transaction.verdict !== "PASS") process.exitCode = 1;
}

async function handleVerifyProof(args: string[]): Promise<void> {
  const path = positional(args)[0];
  if (!path) throw new Error("agenttx verify-proof requires proof.json.");
  const verification = await verifyProofFile(path);
  if (hasFlag(args, "--json")) print(JSON.stringify(verification));
  else {
    print(`Proof verified: ${verification.verdict}`);
    print(`Receipt SHA-256: ${verification.digest}`);
    print(`Transaction: ${verification.transactionId}`);
    print("Proof Card and reproduction record match. Authentication: none.");
  }
}

async function handleRenderProof(args: string[]): Promise<void> {
  const source = positional(args)[0];
  if (!source) throw new Error("agenttx render-proof requires proof.json.");
  const artifact = JSON.parse(await readFile(resolve(source), "utf8")) as ProofArtifact;
  verifyProofArtifact(artifact);
  const destination = resolve(flagValue(args, "--output") ?? "proof.html");
  if (await pathExists(destination)) throw new Error(`Refusing to overwrite existing file: ${destination}`);
  await writeFile(destination, renderProofCard(artifact), { flag: "wx", mode: 0o600 });
  print(destination);
}

async function handleInit(args: string[]): Promise<void> {
  if (!hasFlag(args, "--github")) throw new Error("agenttx init currently requires --github.");
  const repositoryRoot = await findRepository(process.cwd());
  const paths = await initializeGitHub(repositoryRoot);
  for (const path of paths) print(`Created ${path}`);
  const badge = flagValue(args, "--badge");
  if (badge) {
    print("\nOptional workflow badge (not written):");
    print(badgeSnippet(badge));
  }
}

async function handleFeedback(args: string[]): Promise<void> {
  const path = positional(args)[0];
  if (!path) throw new Error("agenttx feedback requires proof.json.");
  const verification = await verifyProofFile(path);
  const artifact = JSON.parse(await readFile(resolve(path), "utf8")) as ProofArtifact;
  const included = {
    agenttxVersion: artifact.proof.agenttxVersion,
    verdict: verification.verdict,
    receiptDigest: verification.digest,
    transactionId: verification.transactionId
  };
  print("No data was uploaded. This URL includes exactly:");
  print(JSON.stringify(included, null, 2));
  const body = encodeURIComponent(`AgentTX proof feedback\n\n${JSON.stringify(included, null, 2)}`);
  print(`\nhttps://github.com/aliengineering-byte/agenttx/issues/new?title=Proof%20feedback&body=${body}`);
  print("The browser was not opened.");
}

function parseRun(args: string[]): { allowExternal: boolean; command: CommandSpec } {
  const remaining = [...args];
  let allowExternal = false;
  while (remaining[0]?.startsWith("--")) {
    const flag = remaining.shift();
    if (flag === "--") break;
    if (flag === "--allow-external") {
      allowExternal = true;
      continue;
    }
    throw new Error(`Unknown run option: ${flag}`);
  }
  const command = remaining.shift();
  if (!command) throw new Error("agenttx run requires a command.");
  return { allowExternal, command: { command, args: remaining } };
}

async function handleRun(args: string[]): Promise<void> {
  const parsed = parseRun(args);
  const adapter = resolveAdapter(parsed.command.command);
  const executionCommand = adapter.command(parsed.command.command, parsed.command.args);
  const metadata = await createTransaction(process.cwd(), executionCommand, {
    allowExternal: parsed.allowExternal,
    agent: adapter.id
  });
  print(`AgentTX ${metadata.transactionId}`);
  print(`Isolated workspace: ${metadata.worktree}`);
  print();
  const result = await runTransaction(metadata, cliPath, executionCommand);
  const inspection = await inspectTransaction(result.metadata);
  print(renderTransactionReport(inspection));
  process.exitCode = result.exitCode;
}

async function handleStatus(args: string[]): Promise<void> {
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd());
  print(hasFlag(args, "--json") ? JSON.stringify(metadata, null, 2) : renderStatus(metadata));
}

async function handleDiff(args: string[]): Promise<void> {
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd());
  const inspection = await inspectTransaction(metadata);
  print(renderDiffSummary(inspection.diff));
  if (hasFlag(args, "--full")) {
    print();
    print(redactText(await transactionPatch(metadata)));
  }
}

async function handleInspect(args: string[]): Promise<void> {
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd());
  const inspection = await inspectTransaction(metadata);
  print(hasFlag(args, "--json") ? JSON.stringify(inspection, null, 2) : renderTransactionReport(inspection));
}

async function handleVerify(args: string[]): Promise<void> {
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd(), false);
  if (metadata.status !== "REVIEW") throw new Error("Verification requires a transaction in REVIEW state.");
  const report = hasFlag(args, "--run")
    ? await runVerification(metadata, cliPath)
    : await readVerification(metadata);
  print(renderVerification(report));
  if (!hasFlag(args, "--run") && report.checks.length) print("\nRun these project-defined commands with: agenttx verify --run");
  if (report.checks.some((item) => item.status === "failed")) process.exitCode = 1;
}

async function handleCommit(args: string[]): Promise<void> {
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd(), false);
  const result = await commitTransaction(metadata);
  print(`Transaction ${result.metadata.transactionId} committed to the original workspace.`);
  print(`Applied ${result.diff.filesChanged} file change${result.diff.filesChanged === 1 ? "" : "s"}.`);
  print("Unrelated working-tree and index changes were preserved. No git commit was created.");
}

async function handleRollback(args: string[]): Promise<void> {
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd(), false);
  const result = await rollbackTransaction(metadata);
  print(`Transaction ${result.metadata.transactionId} rolled back.\n`);
  print(`Discarded ${result.diff.filesChanged} file change${result.diff.filesChanged === 1 ? "" : "s"}.`);
  if (result.originalWorkspaceStatusUnchanged === true) {
    print("Git-visible original workspace status unchanged (digest matched).");
  } else if (result.originalWorkspaceStatusUnchanged === false) {
    print("Warning: Git-visible original workspace status changed during rollback; inspect the evidence artifact.");
  } else {
    print("Warning: original workspace status could not be verified; inspect the evidence artifact.");
  }
  if (result.evidencePath) {
    print(`Rollback evidence: ${result.evidencePath}`);
  } else {
    process.stderr.write(
      `Rollback completed, but evidence could not be written: ${result.evidenceWarning ?? "unknown error"}\n` +
      `Regenerate it with: agenttx evidence ${result.metadata.transactionId}\n`
    );
  }
}

async function handleHistory(args: string[]): Promise<void> {
  const items = await listTransactions();
  print(hasFlag(args, "--json") ? JSON.stringify(items, null, 2) : renderHistory(items));
}

async function handleReplay(args: string[]): Promise<void> {
  const id = positional(args)[0];
  if (!id) throw new Error("agenttx replay requires a transaction ID.");
  const metadata = await resolveTransaction(id, process.cwd());
  const events = await new EventLedger(metadata.transactionDirectory).read();
  if (hasFlag(args, "--json")) {
    print(JSON.stringify(events, null, 2));
    return;
  }
  print(`Recorded events for ${id} (review only; V0 does not deterministically re-execute):`);
  for (const event of events) print(`  ${String(event.seq).padStart(3)}  ${event.timestamp}  ${event.type}`);
}

async function handleEvidence(args: string[]): Promise<void> {
  const id = positional(args)[0];
  if (!id) throw new Error("agenttx evidence requires a transaction ID.");
  const metadata = await resolveTransaction(id, process.cwd());
  const path = await writeRollbackEvidence(metadata, flagValue(args, "--output"));
  print(`Rollback evidence written to ${path}`);
}

async function handleVerifyEvidence(args: string[]): Promise<void> {
  const path = positional(args)[0];
  if (!path) throw new Error("agenttx verify-evidence requires an evidence file.");
  const verification = await verifyRollbackEvidenceFile(path);
  print(`Evidence integrity verified for ${verification.transactionId}.`);
  print(`Receipt SHA-256: ${verification.digest}`);
  print("Authentication: none — this is unsigned, recomputable integrity, not authentication.");
}

async function handleReport(args: string[]): Promise<void> {
  if (!hasFlag(args, "--html")) throw new Error("V0 report output requires --html.");
  const id = positional(args)[0];
  const metadata = await resolveTransaction(id, process.cwd());
  const inspection = await inspectTransaction(metadata);
  const path = await generateHtmlReport(inspection, flagValue(args, "--output"));
  print(`HTML report written to ${path}`);
}

async function handleDoctor(args: string[]): Promise<void> {
  const report = await runDoctor(process.cwd());
  print(hasFlag(args, "--json") ? JSON.stringify(report, null, 2) : renderDoctor(report));
  if (!report.ok) process.exitCode = 1;
}

async function handleDemo(args: string[]): Promise<void> {
  const repository = await mkdtemp(join(tmpdir(), "agenttx-demo-"));
  await mkdir(join(repository, "src"), { recursive: true });
  await mkdir(join(repository, ".github", "workflows"), { recursive: true });
  await writeFile(join(repository, "package.json"), `${JSON.stringify({ name: "agenttx-demo", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`);
  await writeFile(join(repository, "package-lock.json"), `${JSON.stringify({ name: "agenttx-demo", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "agenttx-demo", version: "1.0.0" } } }, null, 2)}\n`);
  await writeFile(join(repository, "src", "auth.ts"), "export function authenticate() {\n  return true;\n}\n");
  await writeFile(join(repository, "src", "legacy.ts"), "export const legacySession = true;\n");
  await writeFile(join(repository, ".github", "workflows", "ci.yml"), "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n");
  await writeFile(join(repository, "README.md"), "# AgentTX deterministic demo\n");
  await execFileAsync("git", ["-C", repository, "init", "-q"]);
  await execFileAsync("git", ["-C", repository, "add", "-A"]);
  await execFileAsync("git", ["-C", repository, "-c", "user.name=AgentTX Demo", "-c", "user.email=demo@agenttx.local", "commit", "-q", "-m", "demo baseline"]);
  const command: CommandSpec = { command: process.execPath, args: [join(packageRoot, "scripts", "fake-agent.mjs")] };
  const metadata = await createTransaction(repository, command, { allowExternal: false, agent: "demo-agent" });
  print("Starting demo transaction...\n");
  const result = await runTransaction(metadata, cliPath, command);
  const inspection = await inspectTransaction(result.metadata);
  print(renderTransactionReport(inspection));
  print("\nDIFF");
  print(renderDiffSummary(inspection.diff));
  if (hasFlag(args, "--keep")) {
    print("\nDemo transaction remains in REVIEW. Try:");
    print(`  agenttx diff ${metadata.transactionId} --full`);
    print(`  agenttx inspect ${metadata.transactionId}`);
    print(`  agenttx rollback ${metadata.transactionId}`);
    print(`\nOriginal demo repository: ${repository}`);
    return;
  }
  const rolledBack = await rollbackTransaction(result.metadata);
  const originalStatus = (await execFileAsync("git", ["-C", repository, "status", "--porcelain"])).stdout.trim();
  print("\nROLLBACK");
  print("  ✓ Transaction rolled back");
  print(`  ✓ ${rolledBack.diff.filesChanged} transaction changes discarded`);
  print(`  ${originalStatus ? "✗" : "✓"} Original workspace unchanged`);
  if (originalStatus) throw new Error("Demo verification failed: original repository is not clean after rollback.");
}

async function main(): Promise<void> {
  const [command = "help", ...args] = process.argv.slice(2);
  if (command === "__shim") {
    const separator = args.indexOf("--");
    const [transactionId, tool, executable] = args.slice(0, separator);
    if (!transactionId || !tool || !executable || separator < 0) throw new Error("Invalid internal shim invocation.");
    process.exitCode = await runShim(transactionId, tool, executable, args.slice(separator + 1));
    return;
  }
  if (command === "verify-evidence") {
    await handleVerifyEvidence(args);
    return;
  }
  if (command === "verify-proof") {
    await handleVerifyProof(args);
    return;
  }
  if (command === "render-proof") {
    await handleRenderProof(args);
    return;
  }
  const recovered = await recoverInterruptedTransactions();
  if (recovered.length && !hasFlag(args, "--json")) {
    for (const item of recovered) {
      process.stderr.write(`Recovered unfinished transaction ${item.transactionId} into ${item.status}. Resume is unsupported in V0.\n`);
    }
  }
  switch (command) {
    case "run": await handleRun(args); break;
    case "proof": await handleProof(args); break;
    case "status": await handleStatus(args); break;
    case "diff": await handleDiff(args); break;
    case "inspect": await handleInspect(args); break;
    case "verify": await handleVerify(args); break;
    case "commit": await handleCommit(args); break;
    case "rollback": await handleRollback(args); break;
    case "history": await handleHistory(args); break;
    case "replay": await handleReplay(args); break;
    case "evidence": await handleEvidence(args); break;
    case "report": await handleReport(args); break;
    case "doctor": await handleDoctor(args); break;
    case "demo": await handleDemo(args); break;
    case "init": await handleInit(args); break;
    case "feedback": await handleFeedback(args); break;
    case "--version":
    case "-v": print(VERSION); break;
    case "help":
    case "--help":
    case "-h": print(help()); break;
    default: throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`AgentTX error: ${redactText((error as Error).message)}\n`);
  process.exitCode = 1;
});
