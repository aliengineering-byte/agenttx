import { spawn } from "node:child_process";
import { extname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { createCommandShims } from "./shims.js";
import { EventLedger } from "./ledger.js";
import { pathExists, writeJsonAtomic } from "./fs.js";
import { prependPath } from "./git.js";
import { SCHEMA_VERSION, type TransactionMetadata, type VerificationCheck, type VerificationReport } from "./types.js";

function check(id: string, command: string, args: string[], source: string): VerificationCheck {
  return { id, command, args, source, status: "detected" };
}

export async function discoverVerification(worktree: string): Promise<VerificationCheck[]> {
  const checks: VerificationCheck[] = [];
  const packagePath = join(worktree, "package.json");
  if (await pathExists(packagePath)) {
    try {
      const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const packageManager = (await pathExists(join(worktree, "pnpm-lock.yaml")))
        ? "pnpm"
        : (await pathExists(join(worktree, "yarn.lock")))
          ? "yarn"
          : "npm";
      for (const name of ["test", "typecheck", "lint"]) {
        const script = packageJson.scripts?.[name];
        if (!script || /echo ["']?Error: no test specified/i.test(script)) continue;
        checks.push(check(`node:${name}`, packageManager, ["run", name], `package.json#scripts.${name}`));
      }
    } catch {
      // Invalid project manifests are reported by the project's own tools, not persisted here.
    }
  }
  if (await pathExists(join(worktree, "Cargo.toml"))) {
    checks.push(check("rust:test", "cargo", ["test"], "Cargo.toml"));
    checks.push(check("rust:clippy", "cargo", ["clippy", "--", "-D", "warnings"], "Cargo.toml"));
  }
  if (await pathExists(join(worktree, "go.mod"))) {
    checks.push(check("go:test", "go", ["test", "./..."], "go.mod"));
  }
  if (
    (await pathExists(join(worktree, "pyproject.toml"))) ||
    (await pathExists(join(worktree, "pytest.ini"))) ||
    (await pathExists(join(worktree, "tests")))
  ) {
    checks.push(check("python:pytest", "pytest", [], "Python project files"));
  }
  return checks;
}

export async function readVerification(metadata: TransactionMetadata): Promise<VerificationReport> {
  const path = join(metadata.transactionDirectory, "verification.json");
  if (await pathExists(path)) return JSON.parse(await readFile(path, "utf8")) as VerificationReport;
  const report: VerificationReport = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    checks: await discoverVerification(metadata.worktree)
  };
  await writeJsonAtomic(path, report);
  return report;
}

function executeCheck(
  item: VerificationCheck,
  cwd: string,
  env: NodeJS.ProcessEnv
): Promise<{ exitCode: number; durationMs: number }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const extension = extname(item.command).toLowerCase();
    const child = spawn(item.command, item.args, {
      cwd,
      env,
      stdio: "inherit",
      shell:
        process.platform === "win32" &&
        ([".cmd", ".bat"].includes(extension) || ["npm", "pnpm", "yarn"].includes(item.command)),
      windowsHide: false
    });
    child.once("error", () => resolve({ exitCode: 1, durationMs: Date.now() - started }));
    child.once("close", (code) => resolve({ exitCode: code ?? 1, durationMs: Date.now() - started }));
  });
}

export async function runVerification(
  metadata: TransactionMetadata,
  cliPath: string
): Promise<VerificationReport> {
  const existing = await readVerification(metadata);
  const shimDirectory = await createCommandShims(metadata, cliPath);
  const ledger = new EventLedger(metadata.transactionDirectory);
  const checks: VerificationCheck[] = [];
  for (const item of existing.checks) {
    await ledger.append("verification.started", { id: item.id, command: item.command, args: item.args });
    const result = await executeCheck(item, metadata.worktree, {
      ...process.env,
      PATH: prependPath(shimDirectory),
      AGENTTX_TRANSACTION_ID: metadata.transactionId,
      AGENTTX_EXTERNAL_POLICY: metadata.allowExternal ? "allow" : "block"
    });
    const updated: VerificationCheck = {
      ...item,
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      durationMs: result.durationMs
    };
    checks.push(updated);
    await ledger.append("verification.completed", {
      id: item.id,
      status: updated.status,
      exitCode: updated.exitCode,
      durationMs: updated.durationMs
    });
  }
  const report: VerificationReport = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    checks
  };
  await writeJsonAtomic(join(metadata.transactionDirectory, "verification.json"), report);
  return report;
}
