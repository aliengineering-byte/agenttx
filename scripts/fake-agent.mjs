import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

await mkdir("src", { recursive: true });
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
packageJson.dependencies = { ...(packageJson.dependencies ?? {}), picocolors: "^1.1.1" };
await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile("src/math.js", "export const add = (left, right) => left + right;\nexport const multiply = (left, right) => left * right;\n");
await writeFile("src/guard.js", "export function requireApproval(action) {\n  return { action, approved: false };\n}\n");
await writeFile("DEMO_RESULT.md", "# Fake agent result\n\nThe isolated agent completed its file edits.\n");

const attempt = spawnSync("git push origin main", {
  shell: true,
  stdio: "inherit",
  env: process.env
});
if (attempt.status !== 77) {
  process.stderr.write("Demo note: the simulated git push did not return AgentTX's block code on this platform.\n");
}
