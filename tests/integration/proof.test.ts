import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { parseProofConfig } from "../../src/proof/config.js";
import { runProof } from "../../src/proof/run.js";
import type { ProofOptions } from "../../src/proof/types.js";
import { verifyProofFile } from "../../src/proof/verify.js";
import { builtCli, createRepository, isolatedHome, text } from "../helpers.js";

const execFileAsync = promisify(execFile);

function options(source: string, overrides: Partial<ProofOptions> = {}): ProofOptions {
  return {
    command: { command: process.execPath, args: ["-e", source] },
    validators: [],
    relatedEvidence: [],
    privacy: "paths",
    timeoutMs: 10_000,
    maxOutputBytes: 64 * 1024,
    maxEvidenceBytes: 1024 * 1024,
    shell: false,
    allowExternal: false,
    commitOnSuccess: true,
    rollbackOnFailure: true,
    dryRun: false,
    ...overrides
  };
}

describe("AgentTX proof mode", () => {
  beforeEach(async () => isolatedHome());

  it("commits a passing change and verifies deterministic proof artifacts", async () => {
    const repository = await createRepository({ "value.txt": "before\n" });
    const result = await runProof(
      repository,
      builtCli,
      options("require('node:fs').writeFileSync('value.txt', 'after\\n')", {
        validators: [{
          id: "value-policy",
          argv: [process.execPath, "-e", "process.exit(require('node:fs').readFileSync('value.txt','utf8') === 'after\\n' ? 0 : 1)"],
          required: true
        }]
      })
    );
    expect(result.artifact.proof.transaction.verdict).toBe("PASS");
    expect(result.artifact.proof.transaction.state).toBe("COMMITTED");
    expect(await text(join(repository, "value.txt"))).toBe("after\n");
    await expect(verifyProofFile(result.proofPath)).resolves.toMatchObject({ valid: true, proofCardVerified: true });
  });

  it("rejects test weakening, rolls back, and fails closed after receipt tampering", async () => {
    const original = "const policy = 'MUST_KEEP_ASSERTION';\n";
    const repository = await createRepository({ "test/policy.test.js": original });
    const result = await runProof(
      repository,
      builtCli,
      options("require('node:fs').writeFileSync('test/policy.test.js', '// skipped\\n')", {
        validators: [{
          id: "no-test-weakening",
          argv: [process.execPath, "-e", "process.exit(require('node:fs').readFileSync('test/policy.test.js','utf8').includes('MUST_KEEP_ASSERTION') ? 0 : 1)"],
          required: true
        }]
      })
    );
    expect(result.artifact.proof.transaction.verdict).toBe("ROLLED_BACK");
    expect(result.artifact.proof.transaction.unrelatedWorkspacePreserved).toBe(true);
    expect(await text(join(repository, "test/policy.test.js"))).toBe(original);
    const artifact = JSON.parse(await readFile(result.proofPath, "utf8")) as {
      proof: { transaction: { reason: string } };
    };
    artifact.proof.transaction.reason = "tampered";
    await writeFile(result.proofPath, `${JSON.stringify(artifact)}\n`);
    await expect(verifyProofFile(result.proofPath)).rejects.toThrow(/digest mismatch/i);
  });

  it("binds verified related evidence and rejects copied-evidence tampering", async () => {
    const repository = await createRepository({ "value.txt": "before\n" });
    const result = await runProof(
      repository,
      builtCli,
      options("require('node:fs').writeFileSync('evidence.json', '{\"ok\":true}\\n')", {
        relatedEvidence: [{
          producer: "example/reliability-engine",
          version: "1.0.0",
          capability: "verify-replay",
          path: "evidence.json",
          verify: [process.execPath, "-e", "const p=process.argv[1];process.exit(JSON.parse(require('node:fs').readFileSync(p,'utf8')).ok ? 0 : 1)", "{evidence}"],
          required: true
        }]
      })
    );
    expect(result.artifact.proof.claims.requiredEvidenceVerified).toBe(true);
    const relatedPath = join(result.outputDirectory, result.artifact.proof.relatedEvidence[0]?.artifactPath ?? "missing");
    await writeFile(relatedPath, "{}\n");
    await expect(verifyProofFile(result.proofPath)).rejects.toThrow(/related evidence digest mismatch/i);
  });

  it("rejects unsafe related paths and existing output directories", async () => {
    expect(() => parseProofConfig({
      relatedEvidence: [{ producer: "x", version: "1", capability: "x", path: "../secret", verify: ["verify"] }]
    })).toThrow(/escapes workspace/i);
    const repository = await createRepository();
    await expect(runProof(repository, builtCli, options("", { outputDirectory: repository })))
      .rejects.toThrow(/refusing to overwrite/i);
  });

  it("escapes HTML-sensitive paths and output", async () => {
    const repository = await createRepository();
    const result = await runProof(
      repository,
      builtCli,
      options("require('node:fs').writeFileSync('<proof>.txt','<script>alert(1)</script>');console.log('<img src=x>')")
    );
    const card = await text(result.cardPath);
    expect(card).toContain("&lt;proof&gt;.txt");
    expect(card).not.toContain("<script>alert(1)</script>");
    expect(card).not.toContain("<img src=x>");
  });

  it("redacts credentials from command and output metadata", async () => {
    const repository = await createRepository();
    const secret = ["ghp", "abcdefghijklmnopqrstuvwxyz123456"].join("_");
    const result = await runProof(
      repository,
      builtCli,
      options(`console.log('${secret}');require('node:fs').writeFileSync('safe.txt','ok')`, {
        command: { command: process.execPath, args: ["-e", `console.log('${secret}');require('node:fs').writeFileSync('safe.txt','ok')`] }
      })
    );
    const serialized = JSON.stringify(result.artifact);
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
  });

  it("rolls back when required related evidence exceeds its bound and still emits a proof", async () => {
    const repository = await createRepository({ "value.txt": "before\n" });
    const result = await runProof(
      repository,
      builtCli,
      options("require('node:fs').writeFileSync('large.json','x'.repeat(2048));require('node:fs').writeFileSync('value.txt','after\\n')", {
        maxEvidenceBytes: 1024,
        relatedEvidence: [{
          producer: "bounded-producer",
          version: "1.0.0",
          capability: "bounded-evidence",
          path: "large.json",
          verify: [process.execPath, "-e", "process.exit(0)"],
          required: true
        }]
      })
    );
    expect(result.artifact.proof.transaction.verdict).toBe("ROLLED_BACK");
    expect(result.artifact.proof.relatedEvidence[0]?.verificationStatus).toBe("failed");
    expect(await text(join(repository, "value.txt"))).toBe("before\n");
    await expect(verifyProofFile(result.proofPath)).resolves.toMatchObject({ valid: true, verdict: "ROLLED_BACK" });
  });

  it("runs the Marketplace Action entry point and emits verified outputs", async () => {
    const repository = await createRepository();
    const output = join(repository, "proof-pack");
    await runProof(repository, builtCli, options("", { outputDirectory: output }));
    const actionFiles = await mkdtemp(join(tmpdir(), "agenttx-action-"));
    const githubOutput = join(actionFiles, "output.txt");
    const githubSummary = join(actionFiles, "summary.md");
    await execFileAsync(process.execPath, ["action/index.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTTX_CLI_PATH: builtCli,
        GITHUB_WORKSPACE: repository,
        GITHUB_OUTPUT: githubOutput,
        GITHUB_STEP_SUMMARY: githubSummary,
        "INPUT_PROOF-JSON": "proof-pack/proof.json",
        "INPUT_RENDER-CARD": "true"
      }
    });
    expect(await text(githubOutput)).toContain("verdict=PASS");
    expect(await text(githubSummary)).toContain("## AgentTX proof: PASS");
  });
});
