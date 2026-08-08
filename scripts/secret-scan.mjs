import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set(["", ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".svg", ".ts", ".txt", ".yml", ".yaml"]);
const implementationExceptions = new Set(["src/core/redaction.ts"]);
const patterns = [
  ["private key block", new RegExp(["BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY"].join(""))],
  ["GitHub token", new RegExp(["gh", "p_[A-Za-z0-9]{20,}"].join(""))],
  ["GitHub fine-grained token", new RegExp(["github_", "pat_[A-Za-z0-9_]{20,}"].join(""))],
  ["OpenAI-style token", new RegExp(["s", "k-[A-Za-z0-9_-]{20,}"].join(""))],
  ["AWS access key", new RegExp(["AK", "IA[A-Z0-9]{16}"].join(""))],
  ["credential assignment", /(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET|password|token)\s*=\s*[^\s"'`<>{}\[\]]{8,}/i],
  ["Windows user path", /[A-Za-z]:\\Users\\[^\\\s]+\\/],
  ["macOS user path", /\/Users\/[^/\s]+\//],
  ["Codex private path", /[\\/]\.codex[\\/]/]
];

async function files(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await files(path));
    else if (entry.isFile() && textExtensions.has(extname(entry.name))) output.push(path);
  }
  return output;
}

const findings = [];
for (const path of await files(root)) {
  const local = relative(root, path).replaceAll("\\", "/");
  if (implementationExceptions.has(local)) continue;
  const content = await readFile(path, "utf8");
  for (const [label, pattern] of patterns) {
    if (pattern.test(content)) findings.push(`${local}: ${label}`);
  }
}

if (findings.length) {
  process.stderr.write(`Potential release disclosure found:\n${findings.map((item) => `  ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Secret and private-path scan passed.\n");
}
