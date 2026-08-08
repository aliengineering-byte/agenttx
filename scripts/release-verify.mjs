import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function execute(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command),
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== (options.expectCode ?? 0)) {
        reject(new Error(`${command} ${args.join(" ")} exited ${result.code}\n${stderr || stdout}`));
      } else {
        resolvePromise(result);
      }
    });
  });
}

async function commandExists(command) {
  try {
    await execute(command, ["--version"], { capture: true });
    return true;
  } catch {
    return false;
  }
}

async function git(cwd, args) {
  return execute("git", ["-C", cwd, ...args], { capture: true });
}

async function initializeRepository(root) {
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "file.txt"), "before\n");
  await writeFile(join(root, "other.txt"), "other baseline\n");
  await writeFile(
    join(root, "agent.mjs"),
    "import { writeFileSync } from 'node:fs';\nwriteFileSync('file.txt', `${process.argv[2]}\\n`);\n"
  );
  await git(root, ["init", "-q"]);
  await git(root, ["add", "-A"]);
  await git(root, [
    "-c",
    "user.name=AgentTX Release Verification",
    "-c",
    "user.email=release@agenttx.local",
    "commit",
    "-q",
    "-m",
    "baseline"
  ]);
}

const project = resolve(fileURLToPath(new URL("..", import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), "agenttx-release-verify-"));
const packDirectory = join(temporary, "pack");
const prefix = join(temporary, "prefix");
const repository = join(temporary, "repository");
const transactionHome = join(temporary, "agenttx-home");
await mkdir(packDirectory);
await mkdir(prefix);

try {
  const hasNpm = await commandExists(process.platform === "win32" ? "npm.cmd" : "npm");
  const packageManager = hasNpm ? (process.platform === "win32" ? "npm.cmd" : "npm") : (process.platform === "win32" ? "pnpm.cmd" : "pnpm");
  if (hasNpm) {
    await execute(packageManager, ["pack", "--pack-destination", packDirectory], { cwd: project });
  } else {
    await execute(packageManager, ["pack", "--pack-destination", packDirectory], { cwd: project });
  }
  const tarball = join(packDirectory, "agenttx-0.1.0.tgz");
  await access(tarball);
  if (hasNpm) {
    await execute(packageManager, ["install", tarball, "--prefix", prefix]);
  } else {
    await execute(packageManager, ["--dir", prefix, "add", tarball]);
  }
  const cli = join(prefix, "node_modules", "agenttx", "dist", "src", "cli.js");
  const shebang = (await readFile(cli, "utf8")).split("\n")[0];
  if (shebang !== "#!/usr/bin/env node") throw new Error(`Unexpected CLI shebang: ${shebang}`);
  const version = (await execute(process.execPath, [cli, "--version"], { capture: true })).stdout.trim();
  if (version !== "0.1.0") throw new Error(`Unexpected installed version: ${version}`);

  await initializeRepository(repository);
  const env = { ...process.env, AGENTTX_HOME: transactionHome };
  const runCli = (args, options = {}) => execute(process.execPath, [cli, ...args], {
    cwd: repository,
    env,
    capture: true,
    ...options
  });
  await runCli(["doctor"]);

  // Scenario A: reject the transaction and prove the original stays clean.
  await runCli(["run", process.execPath, "agent.mjs", "rollback-value"]);
  await runCli(["diff", "--stat"]);
  JSON.parse((await runCli(["inspect", "--json"])).stdout);
  await runCli(["rollback"]);
  if ((await readFile(join(repository, "file.txt"), "utf8")) !== "before\n") {
    throw new Error("Scenario A failed: rollback changed the original file.");
  }
  if ((await git(repository, ["status", "--porcelain"])).stdout.trim()) {
    throw new Error("Scenario A failed: rollback left the original repository dirty.");
  }

  // Scenario B: accept the agent file while preserving unrelated user work.
  await writeFile(join(repository, "other.txt"), "user work\n");
  await runCli(["run", process.execPath, "agent.mjs", "accepted"]);
  await runCli(["diff", "--stat"]);
  JSON.parse((await runCli(["inspect", "--json"])).stdout);
  await runCli(["commit"]);
  if ((await readFile(join(repository, "file.txt"), "utf8")) !== "accepted\n") {
    throw new Error("Scenario B failed: accepted file did not arrive.");
  }
  if ((await readFile(join(repository, "other.txt"), "utf8")) !== "user work\n") {
    throw new Error("Scenario B failed: unrelated user work was changed.");
  }

  // Scenario C: change the same original path and require a safe refusal.
  await runCli(["run", process.execPath, "agent.mjs", "agent-conflict"]);
  await writeFile(join(repository, "file.txt"), "user-conflict\n");
  const conflict = await runCli(["commit"], { expectCode: 1 });
  if (!conflict.stderr.includes("Your existing work was not overwritten")) {
    throw new Error("Scenario C failed: conflict error was not actionable.");
  }
  if ((await readFile(join(repository, "file.txt"), "utf8")) !== "user-conflict\n") {
    throw new Error("Scenario C failed: concurrent user content was overwritten.");
  }
  await runCli(["rollback"]);

  const packageHash = createHash("sha256").update(await readFile(tarball)).digest("hex");
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    packageManager: hasNpm ? "npm" : "pnpm fallback",
    version,
    shebang,
    sha256: packageHash,
    scenarios: {
      rollback: "passed",
      commitPreservesUnrelatedWork: "passed",
      concurrentConflictRefused: "passed"
    }
  }, null, 2)}\n`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
