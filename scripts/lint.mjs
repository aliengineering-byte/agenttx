import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const roots = ["src", "tests", "benchmarks", "scripts"];
const failures = [];

async function visit(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) {
      await visit(fullPath);
      continue;
    }
    if (![".ts", ".mjs"].includes(extname(entry.name))) continue;
    const text = await readFile(fullPath, "utf8");
    text.split("\n").forEach((line, index) => {
      if (/\s+$/.test(line)) failures.push(`${fullPath}:${index + 1}: trailing whitespace`);
      if (/\t/.test(line)) failures.push(`${fullPath}:${index + 1}: tab character`);
    });
    if (!text.endsWith("\n")) failures.push(`${fullPath}: missing final newline`);
  }
}

for (const root of roots) await visit(root);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Style checks passed.");
}
