import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PACKAGE_VERSION = "0.3.0";

function fail(message) {
  process.stderr.write(`::error title=AgentTX proof verification failed::${String(message).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A")}\n`);
  process.exitCode = 1;
}

function contained(root, child) {
  const relation = relative(resolve(root), resolve(child));
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function runCli(args) {
  const override = process.env.AGENTTX_CLI_PATH;
  if (override) return execFileAsync(process.execPath, [override, ...args], { windowsHide: true });
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  return execFileAsync(executable, ["--yes", `--package=agenttx@${PACKAGE_VERSION}`, "--", "agenttx", ...args], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    shell: process.platform === "win32"
  });
}

async function setOutputs(values) {
  const target = process.env.GITHUB_OUTPUT;
  if (!target) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
  await appendFile(target, `${lines}\n`);
}

async function summary(proof, paths) {
  const target = process.env.GITHUB_STEP_SUMMARY;
  if (!target) return;
  const source = "https://github.com/aliengineering-byte/agenttx";
  const markdown = `## AgentTX proof: ${proof.proof.transaction.verdict}\n\n` +
    `- Transaction state: **${proof.proof.transaction.state}**\n` +
    `- Receipt digest: \`${proof.integrity.digest}\`\n` +
    `- Changed files: ${proof.proof.changes.filesChanged}\n` +
    `- Required validators passed: ${proof.proof.claims.requiredValidatorsPassed ? "yes" : "no"}\n` +
    `- Proof JSON: \`${paths.json}\`\n` +
    `- Proof Card: \`${paths.card}\`\n` +
    `- Producer: [AgentTX ${proof.proof.agenttxVersion}](${source})\n\n` +
    `${proof.proof.transaction.reason}\n`;
  await appendFile(target, markdown);
}

async function main() {
  const workspace = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
  const input = process.env["INPUT_PROOF-JSON"];
  if (!input || isAbsolute(input)) throw new Error("proof-json must be a relative repository path.");
  if (!/^[A-Za-z0-9._/\\ -]+$/.test(input)) {
    throw new Error("proof-json contains characters that are unsafe for cross-platform command execution.");
  }
  const proofPath = resolve(workspace, input);
  if (!contained(workspace, proofPath)) throw new Error("proof-json escapes the GitHub workspace.");
  const cardPath = resolve(dirname(proofPath), "proof.html");
  if ((process.env["INPUT_RENDER-CARD"] ?? "true").toLowerCase() === "true") {
    try {
      await readFile(cardPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await runCli(["render-proof", proofPath, "--output", cardPath]);
    }
  }
  await runCli(["verify-proof", proofPath, "--json"]);
  const proof = JSON.parse(await readFile(proofPath, "utf8"));
  const values = {
    verdict: proof.proof.transaction.verdict,
    "receipt-digest": proof.integrity.digest,
    "proof-json-path": proofPath,
    "proof-card-path": cardPath,
    "transaction-state": proof.proof.transaction.state
  };
  await setOutputs(values);
  await summary(proof, { json: proofPath, card: cardPath });
  process.stdout.write(`AgentTX proof verified: ${values.verdict} (${values["receipt-digest"]})\n`);
}

main().catch((error) => fail(error instanceof Error ? error.message : error));
