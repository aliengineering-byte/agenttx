import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageRoot, "dist", "src", "cli.js");
const outputIndex = process.argv.indexOf("--output");
const requestedOutput = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const root = requestedOutput ? resolve(requestedOutput) : await mkdtemp(join(tmpdir(), "agenttx-proof-demo-"));
const repository = join(root, "fixture");
await mkdir(join(repository, "src"), { recursive: true });
await mkdir(join(repository, "test"), { recursive: true });
await mkdir(join(repository, "scripts"), { recursive: true });
await writeFile(join(repository, "package.json"), `${JSON.stringify({
  name: "agenttx-proof-demo",
  private: true,
  type: "module",
  scripts: { test: "node --test" }
}, null, 2)}\n`);
await writeFile(join(repository, "src", "total.js"), "export const total = (left, right) => left - right;\n");
const protectedTest = `import test from "node:test";
import assert from "node:assert/strict";
import { total } from "../src/total.js";

test("adds invoice line items", () => {
  assert.equal(total(20, 22), 42); // AGENTTX_POLICY_REQUIRED
});
`;
await writeFile(join(repository, "test", "total.test.js"), protectedTest);
await writeFile(join(repository, "scripts", "bad-agent.mjs"), `import { writeFile } from "node:fs/promises";
await writeFile("test/total.test.js", "import test from 'node:test';\\nimport assert from 'node:assert/strict';\\ntest('looks green', () => assert.ok(true));\\n");
`);
await writeFile(join(repository, "scripts", "good-agent.mjs"), `import { writeFile } from "node:fs/promises";
await writeFile("src/total.js", "export const total = (left, right) => left + right;\\n");
`);
await writeFile(join(repository, "scripts", "test-policy.mjs"), `import { readFile } from "node:fs/promises";
const source = await readFile("test/total.test.js", "utf8");
if (!source.includes("AGENTTX_POLICY_REQUIRED") || !source.includes("assert.equal(total(20, 22), 42)")) {
  console.error("policy: protected assertion was weakened or removed");
  process.exit(1);
}
`);
await execFileAsync("git", ["-C", repository, "init", "-q"]);
await execFileAsync("git", ["-C", repository, "add", "-A"]);
await execFileAsync("git", ["-C", repository, "-c", "user.name=AgentTX Demo", "-c", "user.email=demo@agenttx.local", "commit", "-q", "-m", "buggy baseline"]);

const validators = [
  JSON.stringify([process.execPath, "scripts/test-policy.mjs"]),
  JSON.stringify([process.execPath, "--test"])
];
async function proof(agent, output) {
  const args = [cli, "proof", "--output", output];
  for (const validator of validators) args.push("--validator", validator);
  args.push("--", process.execPath, `scripts/${agent}-agent.mjs`);
  try {
    return { ...(await execFileAsync(process.execPath, args, { cwd: repository, timeout: 30_000 })), exitCode: 0 };
  } catch (error) {
    return {
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
      exitCode: typeof error.code === "number" ? error.code : 1
    };
  }
}

const started = Date.now();
const badProof = join(root, "bad-proof");
const bad = await proof("bad", badProof);
if (bad.exitCode === 0 || !bad.stdout.includes("ROLLED_BACK")) throw new Error(`Bad agent was not rejected.\n${bad.stdout}\n${bad.stderr}`);
const statusAfterBad = (await execFileAsync("git", ["-C", repository, "status", "--porcelain"])).stdout.trim();
if (statusAfterBad) throw new Error(`Rollback did not restore the fixture: ${statusAfterBad}`);
await execFileAsync(process.execPath, [cli, "verify-proof", join(badProof, "proof.json")], { cwd: repository });

const tamperedProof = join(root, "tampered-proof");
await cp(badProof, tamperedProof, { recursive: true, errorOnExist: true });
const tamperedPath = join(tamperedProof, "proof.json");
const tampered = JSON.parse(await readFile(tamperedPath, "utf8"));
tampered.proof.transaction.reason = "tampered claim";
await writeFile(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
let tamperRejected = false;
try {
  await execFileAsync(process.execPath, [cli, "verify-proof", tamperedPath], { cwd: repository });
} catch {
  tamperRejected = true;
}
if (!tamperRejected) throw new Error("Tampered proof was accepted.");

const goodProof = join(root, "good-proof");
const good = await proof("good", goodProof);
if (good.exitCode !== 0 || !good.stdout.includes("PASS")) throw new Error(`Good agent was not accepted.\n${good.stdout}\n${good.stderr}`);
await execFileAsync(process.execPath, [cli, "verify-proof", join(goodProof, "proof.json")], { cwd: repository });
if ((await readFile(join(repository, "src", "total.js"), "utf8")).includes("left - right")) {
  throw new Error("Good fix was not applied.");
}
if (await readFile(join(repository, "test", "total.test.js"), "utf8") !== protectedTest) {
  throw new Error("Good agent changed the protected test.");
}

const summary = {
  demo: "agenttx-proof-bad-agent-v1",
  elapsedMs: Date.now() - started,
  badAgent: { verdict: "ROLLED_BACK", proof: join(badProof, "proof.json") },
  tamperedReceipt: "REJECTED",
  goodAgent: { verdict: "PASS", proof: join(goodProof, "proof.json") },
  repository
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
