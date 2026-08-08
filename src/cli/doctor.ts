import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { agenttxHome } from "../core/store.js";
import { findRepository, runGit } from "../core/git.js";

const execFileAsync = promisify(execFile);

export interface DoctorReport {
  ok: boolean;
  node: { ok: boolean; version: string; requirement: string };
  git: { ok: boolean; version: string; localClone: boolean };
  store: { ok: boolean; path: string };
  repository: { ok: boolean; root?: string; message?: string };
  platform: { name: NodeJS.Platform; pathShims: "strong" | "best-effort" };
}

export async function runDoctor(cwd: string): Promise<DoctorReport> {
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  let gitVersion = "unavailable";
  let gitOk = false;
  let localClone = false;
  try {
    const result = await execFileAsync("git", ["--version"], { encoding: "utf8", windowsHide: true });
    gitVersion = result.stdout.trim();
    gitOk = true;
    const help = await execFileAsync("git", ["help", "-a"], { encoding: "utf8", windowsHide: true });
    localClone = /\bclone\b/.test(help.stdout);
  } catch {
    // Reported below.
  }
  const home = agenttxHome();
  let storeOk = false;
  const probe = join(home, `.doctor-${process.pid}`);
  try {
    await mkdir(home, { recursive: true });
    await writeFile(probe, "agenttx", { mode: 0o600 });
    await rm(probe, { force: true });
    storeOk = true;
  } catch {
    storeOk = false;
  }
  let repository: DoctorReport["repository"];
  try {
    const root = await findRepository(cwd);
    await runGit(root, ["rev-parse", "--verify", "HEAD"]);
    repository = { ok: true, root };
  } catch (error) {
    repository = { ok: false, message: (error as Error).message };
  }
  return {
    ok: nodeMajor >= 20 && gitOk && localClone && storeOk,
    node: { ok: nodeMajor >= 20, version: process.versions.node, requirement: ">=20" },
    git: { ok: gitOk, version: gitVersion, localClone },
    store: { ok: storeOk, path: home },
    repository,
    platform: { name: process.platform, pathShims: process.platform === "win32" ? "best-effort" : "strong" }
  };
}

export function renderDoctor(report: DoctorReport): string {
  const mark = (ok: boolean): string => (ok ? "✓" : "✗");
  return [
    "AgentTX doctor",
    `  ${mark(report.node.ok)} Node ${report.node.version} (requires ${report.node.requirement})`,
    `  ${mark(report.git.ok && report.git.localClone)} ${report.git.version}; isolated local clone ${report.git.localClone ? "available" : "unavailable"}`,
    `  ${mark(report.store.ok)} Local store ${report.store.path}`,
    `  ${mark(report.repository.ok)} Repository ${report.repository.root ?? report.repository.message ?? "unavailable"}`,
    `  ${mark(report.platform.pathShims === "strong")} PATH command observation: ${report.platform.pathShims}`,
    "",
    report.ok ? "Core requirements satisfied." : "One or more core requirements are not satisfied.",
    "Command observation remains heuristic and is not a security boundary."
  ].join("\n");
}
