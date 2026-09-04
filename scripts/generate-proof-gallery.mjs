import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(source, "dist", "src", "cli.js");
const outputFlag = process.argv.indexOf("--output");
const site = resolve(outputFlag >= 0 ? process.argv[outputFlag + 1] : "gallery-site");
const work = await mkdtemp(join(tmpdir(), "agenttx-gallery-"));

async function repository(name, files) {
  const root = join(work, name);
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  await exec("git", ["-C", root, "init", "-q"]);
  await exec("git", ["-C", root, "add", "-A"]);
  await exec("git", ["-C", root, "-c", "user.name=AEB Proof Gallery", "-c", "user.email=gallery@aeb.invalid", "commit", "-q", "-m", "gallery fixture"]);
  return root;
}

async function proof(root, destination, command, config) {
  await mkdir(join(root, ".agenttx"), { recursive: true });
  await writeFile(join(root, ".agenttx", "proof.json"), `${JSON.stringify(config, null, 2)}\n`);
  await exec(process.execPath, [cli, "proof", "--allow-external", "--config", ".agenttx/proof.json", "--output", destination, "--", ...command], {
    cwd: root,
    timeout: 55_000,
    maxBuffer: 16 * 1024 * 1024
  });
}

await mkdir(site, { recursive: true });

const demoRoot = join(work, "test-weakening-demo");
await exec(process.execPath, [join(source, "scripts", "proof-demo.mjs"), "--output", demoRoot], {
  cwd: source,
  timeout: 55_000,
  maxBuffer: 16 * 1024 * 1024
});
await cp(join(demoRoot, "bad-proof"), join(site, "agent-cheated"), { recursive: true });

const resilireplay = process.env.RESILIREPLAY_COMMAND ?? "resilireplay";
const mcpRoot = await repository("mcp-duplicate-effect", {
  "README.md": "# MCP retry policy\n\nEvidence pending.\n"
});
await proof(mcpRoot, join(site, "mcp-duplicate-effect"), [resilireplay, "mcp", "demo", "--output", ".resilireplay/demo", "--json"], {
  validators: [],
  relatedEvidence: [{
    producer: "io.github.aliengineering-byte/resilireplay",
    version: "0.7.1",
    capability: "bounded-mcp-retry-without-duplicate-effect",
    path: ".resilireplay/demo/evidence.json",
    verify: [resilireplay, "mcp", "verify-evidence", "{evidence}", "--json"],
    required: true
  }]
});

const python = process.env.GALLERY_PYTHON ?? (process.platform === "win32" ? "python.exe" : "python3");
const phaseprobe = process.env.PHASEPROBE_COMMAND ?? "phaseprobe";
const scienceRoot = await repository("scientific-transition", {
  "README.md": "# Logistic transition policy\n\nEvidence pending.\n",
  "scripts/scientific-change.py": `from pathlib import Path
import shutil
import subprocess

subprocess.run([${JSON.stringify(phaseprobe)}, "scan", "--example", "logistic", "--output-root", ".phaseprobe/gallery", "--json"], check=True)
fixtures = sorted(Path(".phaseprobe/gallery").glob("*/replay.json"))
if len(fixtures) != 1:
    raise SystemExit("expected exactly one PhaseProbe replay")
shutil.copyfile(fixtures[0], "phaseprobe-replay.json")
Path("README.md").write_text("# Logistic transition policy\\n\\nThe bounded period-2/period-4 transition is preserved as a replay.\\n", encoding="utf-8")
`
});
await proof(scienceRoot, join(site, "scientific-transition"), [python, "scripts/scientific-change.py"], {
  validators: [],
  relatedEvidence: [{
    producer: "aliengineering-byte/phaseprobe",
    version: "0.3.0",
    capability: "bounded-qualitative-transition-replay",
    path: "phaseprobe-replay.json",
    verify: [phaseprobe, "replay", "{evidence}", "--json"],
    required: true
  }]
});

const commit = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const entries = [
  {
    slug: "agent-cheated",
    title: "Agent cheated by weakening a test",
    problem: "A command replaced a protected failing assertion with an always-green test.",
    behavior: "The policy validator detected the weakened test; the claimed success was rejected and the original tree restored.",
    component: "AgentTX 0.3.0",
    command: "npm run demo:proof",
    verdict: "ROLLED_BACK",
    limitations: "Deterministic fixture policy evidence; not a general detector for every possible test weakening."
  },
  {
    slug: "mcp-duplicate-effect",
    title: "MCP retry created or threatened a duplicate effect",
    problem: "A controlled MCP tool failure exercised a retry boundary where duplicate effects are the central risk.",
    behavior: "ResiliReplay reproduced the failure, bounded recovery to one retry, observed zero duplicate effects, and generated a regression.",
    component: "AgentTX 0.3.0 + ResiliReplay 0.7.1",
    command: "agenttx proof --allow-external -- resilireplay mcp demo --output .resilireplay/demo --json",
    verdict: "PASS",
    limitations: "Local deterministic MCP fixture evidence; it does not prove an arbitrary remote tool is idempotent."
  },
  {
    slug: "scientific-transition",
    title: "Scientific behavior crossed a qualitative transition",
    problem: "A logistic-map parameter crossed a finite-time period-2/period-4 classification boundary.",
    behavior: "PhaseProbe found and replayed a bounded bracket; AgentTX bound its independently verified replay evidence.",
    component: "AgentTX 0.3.0 + PhaseProbe 0.3.0",
    command: "agenttx proof --allow-external -- python scripts/scientific-change.py",
    verdict: "PASS",
    limitations: "Numerical finite-time classification evidence; not an exact bifurcation point or scientific truth claim."
  }
];

for (const entry of entries) {
  const artifact = JSON.parse(await readFile(join(site, entry.slug, "proof.json"), "utf8"));
  if (artifact.proof.transaction.verdict !== entry.verdict) throw new Error(`${entry.slug} verdict mismatch`);
  const color = entry.verdict === "PASS" ? "#087f5b" : "#c92a2a";
  const related = artifact.proof.relatedEvidence.length
    ? `${artifact.proof.relatedEvidence[0].producer} ${artifact.proof.relatedEvidence[0].producerVersion}`
    : "AgentTX policy validator";
  await writeFile(join(site, entry.slug, "proof-card.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" role="img" aria-labelledby="title desc"><title id="title">AgentTX Proof ${entry.verdict}</title><desc id="desc">${escape(entry.title)}</desc><rect width="1200" height="630" fill="#11151a"/><rect x="55" y="55" width="1090" height="520" rx="30" fill="#191f26" stroke="#36414d" stroke-width="2"/><text x="105" y="125" font-family="system-ui,sans-serif" font-size="24" fill="#aab4c0" letter-spacing="4">AGENTTX PROOF CARD</text><text x="105" y="260" font-family="system-ui,sans-serif" font-weight="800" font-size="105" fill="${color}">${entry.verdict}</text><text x="105" y="330" font-family="system-ui,sans-serif" font-size="34" fill="#f2f4f7">${escape(entry.title)}</text><text x="105" y="405" font-family="system-ui,sans-serif" font-size="24" fill="#aab4c0">${escape(related)}</text><text x="105" y="470" font-family="ui-monospace,monospace" font-size="19" fill="#aab4c0">sha256:${artifact.integrity.digest}</text><text x="105" y="525" font-family="ui-monospace,monospace" font-size="22" fill="#f2f4f7">agenttx verify-proof proof.json</text></svg>`, "utf8");
}

const cards = entries.map((entry) => `<article>
<p class="verdict">${entry.verdict}</p><h2>${escape(entry.title)}</h2>
<dl><dt>Problem</dt><dd>${escape(entry.problem)}</dd><dt>Risky behavior</dt><dd>${escape(entry.behavior)}</dd><dt>AEB component</dt><dd>${escape(entry.component)}</dd><dt>Exact command</dt><dd><code>${escape(entry.command)}</code></dd><dt>Source</dt><dd><a href="https://github.com/aliengineering-byte/agenttx/commit/${commit}">${commit.slice(0, 12)}</a></dd><dt>Limitations</dt><dd>${escape(entry.limitations)}</dd></dl>
<p><a href="${entry.slug}/proof.html">Proof Card</a> · <a href="${entry.slug}/proof-card.svg">rendered example</a> · <a href="${entry.slug}/proof.json">machine-readable evidence</a> · <a href="${entry.slug}/reproduce.md">reproduction record</a></p>
</article>`).join("\n");
await writeFile(join(site, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>AEB Proof Gallery</title><style>:root{font-family:system-ui,sans-serif;color-scheme:light dark}body{max-width:980px;margin:auto;padding:2rem;line-height:1.5}header{margin-block:3rem}article{border:1px solid #778;border-radius:1rem;padding:1.5rem;margin:1.5rem 0}.verdict{font-weight:800;letter-spacing:.12em}dt{font-weight:700;margin-top:.7rem}dd{margin-left:0}code{overflow-wrap:anywhere}a{color:inherit}</style></head><body><header><p>AEB Proof</p><h1>Three reproducible proof packs</h1><p>Generated in CI from real commands. No accounts, analytics, telemetry, or external storage.</p></header><main>${cards}</main><footer>AgentTX 0.3.0 · source ${commit} · receipts use unsigned recomputable integrity, not producer authentication.</footer></body></html>`, "utf8");
await writeFile(join(site, ".nojekyll"), "", "utf8");
process.stdout.write(`${JSON.stringify({ status: "PASS", entries: entries.length, sourceCommit: commit, site })}\n`);
