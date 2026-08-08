import { spawn, type ChildProcess } from "node:child_process";
import { extname, join } from "node:path";
import { detectSideEffect, shouldBlockFinding } from "../detectors/side-effects.js";
import { detectSecretPathArguments } from "../detectors/secrets.js";
import { EventLedger } from "./ledger.js";
import { prependPath } from "./git.js";
import { redactText, sanitizeCommand } from "./redaction.js";
import { createCommandShims } from "./shims.js";
import { transitionTransaction, writeMetadata } from "./store.js";
import type { CommandSpec, TransactionMetadata } from "./types.js";
import { finalizeTransaction } from "./workspace.js";

export interface RunResult {
  metadata: TransactionMetadata;
  exitCode: number;
  signal: NodeJS.Signals | null;
}

function waitForChild(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

function signalExitCode(signal: NodeJS.Signals | null): number {
  if (signal === "SIGHUP") return 129;
  if (signal === "SIGINT") return 130;
  if (signal === "SIGTERM") return 143;
  return signal ? 128 : 1;
}

export async function runTransaction(
  initialMetadata: TransactionMetadata,
  cliPath: string,
  executionCommand: CommandSpec
): Promise<RunResult> {
  let metadata = initialMetadata;
  const ledger = new EventLedger(metadata.transactionDirectory);
  const started = Date.now();
  metadata = await transitionTransaction(metadata, "RUNNING", {
    startedAt: new Date(started).toISOString(),
    parentPid: process.pid
  });
  const safeCommand = sanitizeCommand(executionCommand.command, executionCommand.args);
  await ledger.append("process.started", { command: safeCommand, interactive: true });
  for (const secret of detectSecretPathArguments(executionCommand.args)) {
    await ledger.append("secret.path_referenced", { finding: secret });
  }
  const topLevelFinding = detectSideEffect(executionCommand.command, executionCommand.args);
  let exitCode = 0;
  let signal: NodeJS.Signals | null = null;
  let interrupted = false;

  if (topLevelFinding && shouldBlockFinding(topLevelFinding, metadata.allowExternal)) {
    const blocked = { ...topLevelFinding, blocked: true };
    await ledger.append("side_effect.blocked", { finding: blocked, observation: "top-level" });
    process.stderr.write(
      `AgentTX blocked the command: ${blocked.reason}.\n` +
        `Evidence: ${blocked.evidence}\n` +
        `Re-run with --allow-external only if you explicitly accept the external side effect.\n`
    );
    exitCode = 77;
  } else {
    if (topLevelFinding) {
      await ledger.append("side_effect.allowed", {
        finding: { ...topLevelFinding, blocked: false },
        observation: "top-level"
      });
    }
    const shimDirectory = await createCommandShims(metadata, cliPath);
    const workingDirectory = join(metadata.worktree, metadata.invocationDirectory);
    const extension = extname(executionCommand.command).toLowerCase();
    const child = spawn(executionCommand.command, executionCommand.args, {
      cwd: workingDirectory,
      env: {
        ...process.env,
        PATH: prependPath(shimDirectory),
        AGENTTX_TRANSACTION_ID: metadata.transactionId,
        AGENTTX_TRANSACTION_WORKSPACE: metadata.worktree,
        AGENTTX_ORIGINAL_WORKSPACE: metadata.repositoryRoot,
        AGENTTX_EXTERNAL_POLICY: metadata.allowExternal ? "allow" : "block"
      },
      stdio: "inherit",
      shell: process.platform === "win32" && [".cmd", ".bat"].includes(extension),
      windowsHide: false
    });
    metadata = { ...metadata, childPid: child.pid };
    await writeMetadata(metadata);

    const onSignal = (received: NodeJS.Signals): void => {
      interrupted = true;
      signal = received;
      void ledger.append("process.signal", { signal: received });
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill(received);
        } catch {
          child.kill();
        }
      }
    };
    const signalHandlers = new Map<NodeJS.Signals, () => void>();
    for (const handled of ["SIGINT", "SIGTERM", "SIGHUP"] as NodeJS.Signals[]) {
      const handler = (): void => onSignal(handled);
      signalHandlers.set(handled, handler);
      try {
        process.on(handled, handler);
      } catch {
        // Some signals are unavailable on Windows.
      }
    }
    try {
      const result = await waitForChild(child);
      exitCode = result.code ?? signalExitCode(result.signal);
      signal = result.signal;
    } catch (error) {
      exitCode = 1;
      await ledger.append("process.failed", { error: redactText((error as Error).message) });
    } finally {
      for (const [handled, handler] of signalHandlers) process.off(handled, handler);
    }
  }

  const durationMs = Date.now() - started;
  await ledger.append("process.exited", { exitCode, signal, durationMs });
  try {
    await finalizeTransaction(metadata);
    metadata = await transitionTransaction(metadata, "REVIEW", {
      exitCode,
      durationMs,
      completedAt: new Date().toISOString(),
      interrupted: interrupted || signal !== null,
      childPid: undefined
    });
    await ledger.append("transaction.review", { exitCode, durationMs });
  } catch (error) {
    metadata = await transitionTransaction(metadata, "FAILED", {
      exitCode,
      durationMs,
      completedAt: new Date().toISOString(),
      interrupted: interrupted || signal !== null,
      childPid: undefined,
      failure: redactText((error as Error).message)
    });
    await ledger.append("transaction.failed", { error: redactText((error as Error).message) });
  }
  return { metadata, exitCode, signal };
}
