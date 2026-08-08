import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const pause = () => new Promise((resolve) => setTimeout(resolve, 220));
const step = async (message) => {
  process.stdout.write(`  ${message}\n`);
  await pause();
};

process.stdout.write("Agent:\n");

await step("editing src/auth.ts");
await writeFile(
  "src/auth.ts",
  "export function authenticate(token) {\n  return typeof token === \"string\" && token.length > 0;\n}\n"
);

await step("creating src/session.ts");
await writeFile(
  "src/session.ts",
  "export function createSession(userId) {\n  return { userId, createdAt: new Date().toISOString() };\n}\n"
);

await step("deleting src/legacy.ts");
await rm("src/legacy.ts");

await step("adding a package dependency");
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
packageJson.dependencies = { ...(packageJson.dependencies ?? {}), picocolors: "^1.1.1" };
await writeFile("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);
const packageLock = JSON.parse(await readFile("package-lock.json", "utf8"));
packageLock.packages[""].dependencies = { picocolors: "^1.1.1" };
packageLock.packages["node_modules/picocolors"] = {
  version: "1.1.1",
  resolved: "https://registry.npmjs.org/picocolors/-/picocolors-1.1.1.tgz",
  integrity: "sha512-xIe2XfKldZPnCEijioYUyed7oFHpDywJgmgWG8VDCNvNr50teOP6SckvhiSmPDCjMPQ9pOMGV2N59WfPjLmg4w=="
};
await writeFile("package-lock.json", `${JSON.stringify(packageLock, null, 2)}\n`);

await step("changing .github/workflows/ci.yml");
await mkdir(".github/workflows", { recursive: true });
await writeFile(
  ".github/workflows/ci.yml",
  "name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test -- --runInBand\n"
);

await writeFile(
  "AGENT_RESULT.md",
  "# Agent result\n\nAuthentication and session handling were updated.\n"
);

await step("attempting simulated external write: git push origin main");
const attempt = spawnSync("git push origin main", {
  shell: true,
  stdio: "inherit",
  env: process.env
});
if (attempt.status !== 77) {
  process.stderr.write("Demo note: the simulated git push did not return AgentTX's block code on this platform.\n");
}
