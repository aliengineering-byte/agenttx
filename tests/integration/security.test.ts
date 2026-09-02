import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { createTransaction, transactionPatch } from "../../src/core/workspace.js";
import { runTransaction } from "../../src/core/runner.js";
import { inspectTransaction } from "../../src/core/inspection.js";
import { EventLedger } from "../../src/core/ledger.js";
import { generateHtmlReport } from "../../src/reporters/html.js";
import { renderTransactionReport } from "../../src/reporters/terminal.js";
import type { CommandSpec } from "../../src/core/types.js";
import { builtCli, createRepository, isolatedHome, runNodeTransaction } from "../helpers.js";

const execFileAsync = promisify(execFile);

beforeEach(async () => {
  await isolatedHome();
});

describe("side-effect gating and privacy", () => {
  it("blocks a simulated git push launched by the child and records evidence", async () => {
    const repository = await createRepository();
    const source = `const {spawnSync}=require('node:child_process');const r=spawnSync('git push origin main',{shell:true,stdio:'inherit'});if(r.status!==77)process.exit(4)`;
    const command: CommandSpec = { command: process.execPath, args: ["-e", source] };
    const created = await createTransaction(repository, command, { allowExternal: false, agent: "test" });
    const result = await runTransaction(created, builtCli, command);
    expect(result.exitCode).toBe(0);
    const inspection = await inspectTransaction(result.metadata);
    expect(inspection.sideEffects).toEqual([
      expect.objectContaining({ category: "external_write", blocked: true, evidence: "git push origin main" })
    ]);
    expect(inspection.risk.score).toBeGreaterThanOrEqual(3);
  });

  it("blocks a risky top-level command without executing it", async () => {
    const repository = await createRepository();
    const command: CommandSpec = { command: "git", args: ["push", "origin", "main"] };
    const created = await createTransaction(repository, command, { allowExternal: false, agent: "generic" });
    const result = await runTransaction(created, builtCli, command);
    expect(result.exitCode).toBe(77);
    expect(result.metadata.status).toBe("REVIEW");
    expect((await inspectTransaction(result.metadata)).sideEffects[0]?.blocked).toBe(true);
  });

  it("never persists or renders a raw token", async () => {
    const repository = await createRepository();
    const token = ["gh", "p_abcdefghijklmnopqrstuvwxyz123456"].join("");
    const source = `require('node:fs').writeFileSync('.env','GITHUB_TOKEN=${token}\\n')`;
    const command: CommandSpec = { command: process.execPath, args: ["--token", token, "-e", source] };
    const created = await createTransaction(repository, command, { allowExternal: false, agent: "test" });
    // Execute a separate safe command so the intentionally secret-bearing metadata arguments are never interpreted by Node.
    const execution: CommandSpec = { command: process.execPath, args: ["-e", source] };
    const result = await runTransaction(created, builtCli, execution);
    const inspection = await inspectTransaction(result.metadata);
    const htmlPath = await generateHtmlReport(inspection);
    const artifacts = [
      await readFile(join(created.transactionDirectory, "metadata.json"), "utf8"),
      await readFile(join(created.transactionDirectory, "events.jsonl"), "utf8"),
      JSON.stringify(inspection),
      renderTransactionReport(inspection),
      await readFile(htmlPath, "utf8"),
      await transactionPatch(result.metadata)
    ];
    for (const artifact of artifacts) expect(artifact).not.toContain(token);
    expect(inspection.secrets).toEqual(expect.arrayContaining([expect.objectContaining({ path: ".env", value: "[REDACTED]" })]));
  });

  it("redacts tokens passed through shim ledger events", async () => {
    const repository = await createRepository();
    const command: CommandSpec = { command: process.execPath, args: ["-e", "process.exit(0)"] };
    const created = await createTransaction(repository, command, { allowExternal: false, agent: "test" });
    const ledger = new EventLedger(created.transactionDirectory);
    const token = ["s", "k-abcdefghijklmnopqrstuvwxyz123456"].join("");
    await ledger.append("debug", { error: `request failed token=${token}` });
    expect(await readFile(ledger.path, "utf8")).not.toContain(token);
  });

  it("returns the child exit code from the public CLI", async () => {
    const repository = await createRepository();
    let code: number | string | undefined;
    let stdout = "";
    try {
      const result = await execFileAsync(process.execPath, [builtCli, "run", process.execPath, "-e", "process.exit(7)"], {
        cwd: repository,
        env: process.env,
        encoding: "utf8",
        windowsHide: true
      });
      stdout = result.stdout;
      code = 0;
    } catch (error) {
      const failure = error as { code?: number | string; stdout?: string };
      code = failure.code;
      stdout = failure.stdout ?? "";
    }
    expect(code).toBe(7);
    expect(stdout).not.toContain("\u001B[");
  });

  it.skipIf(process.platform === "win32")("maps SIGINT to the conventional exit code", async () => {
    const repository = await createRepository();
    let code: number | string | undefined;
    try {
      await execFileAsync(process.execPath, [builtCli, "run", process.execPath, "-e", "process.kill(process.pid, 'SIGINT')"], {
        cwd: repository,
        env: process.env,
        encoding: "utf8",
        windowsHide: true
      });
      code = 0;
    } catch (error) {
      code = (error as { code?: number | string }).code;
    }
    expect(code).toBe(130);
  });

  it("machine-readable status contains the versioned schema", async () => {
    const repository = await createRepository();
    const command: CommandSpec = { command: process.execPath, args: ["-e", "process.exit(0)"] };
    const created = await createTransaction(repository, command, { allowExternal: false, agent: "test" });
    const result = await execFileAsync(process.execPath, [builtCli, "status", created.transactionId, "--json"], {
      cwd: repository,
      env: process.env,
      encoding: "utf8",
      windowsHide: true
    });
    const value = JSON.parse(result.stdout) as { schemaVersion: number; transactionId: string };
    expect(value).toMatchObject({ schemaVersion: 1, transactionId: created.transactionId });
  });

  it("reports rollback proof and regenerates evidence from the terminal ledger", async () => {
    const repository = await createRepository();
    const metadata = await runNodeTransaction(
      repository,
      `require('node:fs').writeFileSync('file.txt','agent\\n')`
    );
    const rollback = await execFileAsync(
      process.execPath,
      [builtCli, "rollback", metadata.transactionId],
      { cwd: repository, env: process.env, encoding: "utf8", windowsHide: true }
    );
    expect(rollback.stdout).toContain("Git-visible original workspace status unchanged (digest matched).");
    expect(rollback.stdout).toContain("Rollback evidence:");
    const evidencePath = join(metadata.transactionDirectory, "rollback-evidence.json");
    await rm(evidencePath);
    const regenerated = await execFileAsync(
      process.execPath,
      [builtCli, "evidence", metadata.transactionId],
      { cwd: repository, env: process.env, encoding: "utf8", windowsHide: true }
    );
    expect(regenerated.stdout).toContain("Rollback evidence written to");
    const evidence = JSON.parse(await readFile(evidencePath, "utf8")) as {
      receipt: { evidenceType: string; transaction: { state: string }; result: { filesDiscarded: number } };
    };
    expect(evidence.receipt).toMatchObject({
      evidenceType: "agenttx.rollback",
      transaction: { state: "ROLLED_BACK" }
    });
    const verified = await execFileAsync(
      process.execPath,
      [builtCli, "verify-evidence", evidencePath],
      { cwd: repository, env: process.env, encoding: "utf8", windowsHide: true }
    );
    expect(verified.stdout).toContain("Evidence integrity verified");
    expect(verified.stdout).toContain("unsigned, recomputable integrity, not authentication");

    evidence.receipt.result.filesDiscarded += 1;
    await writeFile(evidencePath, `${JSON.stringify(evidence)}\n`);
    await expect(
      execFileAsync(
        process.execPath,
        [builtCli, "verify-evidence", evidencePath],
        { cwd: repository, env: process.env, encoding: "utf8", windowsHide: true }
      )
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Evidence receipt digest mismatch")
    });
  });
});
