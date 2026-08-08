import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import { detectSideEffect, SHIM_TOOLS, shouldBlockFinding } from "../detectors/side-effects.js";
import { detectSecretPathArguments } from "../detectors/secrets.js";
import { EventLedger } from "./ledger.js";
import { redactText, sanitizeCommand } from "./redaction.js";
import { readMetadata } from "./store.js";
import type { TransactionMetadata } from "./types.js";

const execFileAsync = promisify(execFile);

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function findExecutable(tool: string, path = process.env.PATH ?? ""): Promise<string | null> {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    const result = await execFileAsync(locator, [tool], {
      encoding: "utf8",
      env: { ...process.env, PATH: path },
      windowsHide: true
    });
    return result.stdout.split(/\r?\n/).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export async function createCommandShims(
  metadata: TransactionMetadata,
  cliPath: string,
  originalPath = process.env.PATH ?? ""
): Promise<string> {
  const directory = join(metadata.transactionDirectory, "shims");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const tool of SHIM_TOOLS) {
    const executable = await findExecutable(tool, originalPath);
    if (!executable) continue;
    if (process.platform === "win32") {
      const wrapperPath = join(directory, `${tool}.cmd`);
      const script = `@echo off\r\n"${process.execPath}" "${cliPath}" __shim "${metadata.transactionId}" "${tool}" "${executable}" -- %*\r\n`;
      await writeFile(wrapperPath, script, { mode: 0o700 });
    } else {
      const wrapperPath = join(directory, tool);
      const script = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} __shim ${shellQuote(metadata.transactionId)} ${shellQuote(tool)} ${shellQuote(executable)} -- "$@"\n`;
      await writeFile(wrapperPath, script, { mode: 0o700 });
      await chmod(wrapperPath, 0o700);
    }
  }
  return directory;
}

function spawnAndWait(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const extension = extname(command).toLowerCase();
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      shell: process.platform === "win32" && [".cmd", ".bat"].includes(extension),
      windowsHide: false
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

export async function runShim(
  transactionId: string,
  tool: string,
  realExecutable: string,
  args: string[]
): Promise<number> {
  const metadata = await readMetadata(transactionId);
  const ledger = new EventLedger(metadata.transactionDirectory);
  const safe = sanitizeCommand(tool, args);
  await ledger.append("command.observed", {
    command: safe,
    observation: "path-shim",
    limitation: "Best-effort PATH interception; not a security boundary"
  });
  for (const secret of detectSecretPathArguments(args)) {
    await ledger.append("secret.path_referenced", { finding: secret });
  }
  const sideEffect = detectSideEffect(tool, args);
  if (sideEffect) {
    const blocked = shouldBlockFinding(sideEffect, metadata.allowExternal);
    const recorded = { ...sideEffect, blocked };
    await ledger.append(blocked ? "side_effect.blocked" : "side_effect.allowed", {
      finding: recorded
    });
    if (blocked) {
      process.stderr.write(
        `\nAgentTX blocked ${basename(tool)}: ${recorded.reason}.\n` +
          `Evidence: ${recorded.evidence}\n` +
          `This heuristic gate is not an OS security boundary.\n\n`
      );
      return 77;
    }
  }
  try {
    const exitCode = await spawnAndWait(realExecutable, args);
    await ledger.append("command.exited", { command: safe, exitCode });
    return exitCode;
  } catch (error) {
    await ledger.append("command.failed", {
      command: safe,
      error: redactText((error as Error).message)
    });
    throw error;
  }
}
