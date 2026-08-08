import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const ignored = new Set([".git", "node_modules", "dist", "coverage"]);

async function markdownFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await markdownFiles(path));
    else if (entry.isFile() && extname(entry.name) === ".md") output.push(path);
  }
  return output;
}

const broken = [];
for (const source of await markdownFiles(root)) {
  const content = await readFile(source, "utf8");
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1]?.trim();
    if (!target || /^(?:https?:|mailto:|#)/i.test(target) || target.includes("<OWNER>")) continue;
    const withoutAnchor = decodeURIComponent(target.split("#")[0] ?? "");
    try {
      await access(resolve(dirname(source), withoutAnchor));
    } catch {
      broken.push(`${source.slice(root.length + 1)} -> ${target}`);
    }
  }
}

if (broken.length) {
  process.stderr.write(`Broken local Markdown links:\n${broken.map((item) => `  ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Local Markdown links passed.\n");
}
