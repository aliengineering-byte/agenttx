import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { agenttxHome } from "../core/store.js";
import { findRepository, runGit } from "../core/git.js";

const execFileAsync = promisify(execFile);

export interface DoctorAgent {
  id: "claude" | "codex" | "gemini" | "opencode";
  label: string;
  available: boolean;
  version?: string;
}

export interface DoctorReport {
  schemaVersion: 1;
  ok: boolean;
  node: { ok: boolean; version: string; requirement: string };
  git: { ok: boolean; version: string; localClone: boolean };
  store: { ok: boolean; writable: boolean; path: string };
  repository: {
    ok: boolean;
    detected: boolean;
    hasCommits: boolean;
    supportedState: boolean;
    root?: string;
    message?: string;
  };
  agents: DoctorAgent[];
  platform: { name: NodeJS.Platform; pathShims: "strong" | "best-effort" };
  next: string[];
}

async function probeAgent(id: DoctorAgent["id"], label: string): Promise<DoctorAgent> {
  try {
    const result = await execFileAsync(id, ["--version"], {
      encoding: "utf8",
      timeout: 2_000,
      windowsHide: true,
      env: process.env
    });
    const version = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).find((line) => line.trim())?.trim();
    return { id, label, available: true, ...(version ? { version } : {}) };
  } catch {
    return { id, label, available: false };
  }
}

async function repositoryHealth(cwd: string): Promise<DoctorReport["repository"]> {
  let root: string;
  try {
    root = await findRepository(cwd);
  } catch {
    return {
      ok: false,
      detected: false,
      hasCommits: false,
      supportedState: false,
      message: "No Git repository detected. Run AgentTX from a repository with at least one commit."
    };
  }
  const head = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const hasCommits = Boolean(head.stdout.trim());
  const staged = await runGit(root, ["ls-files", "--stage"]);
  const hasSubmodules = staged.stdout.split(/\r?\n/).some((line) => line.startsWith("160000 "));
  let activeOperation: string | undefined;
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"]) {
    const markerResult = await runGit(root, ["rev-parse", "--git-path", marker]);
    const markerPath = markerResult.stdout.trim();
    if (markerPath) {
      try {
        const { access } = await import("node:fs/promises");
        await access(resolve(root, markerPath));
        activeOperation = marker.replace("_HEAD", "").replace("_LOG", "").toLowerCase();
        break;
      } catch {
        // Marker is absent.
      }
    }
  }
  const supportedState = hasCommits && !hasSubmodules && !activeOperation;
  const message = !hasCommits
    ? "Repository has no commits. Create an initial commit before starting AgentTX."
    : hasSubmodules
      ? "Git submodules are not supported in V0."
      : activeOperation
        ? `Finish the active Git ${activeOperation} operation before starting AgentTX.`
        : undefined;
  return {
    ok: supportedState,
    detected: true,
    hasCommits,
    supportedState,
    root,
    ...(message ? { message } : {})
  };
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
    // Reported in the structured result.
  }
  const home = agenttxHome();
  let storeOk = false;
  const probe = join(home, `.doctor-${process.pid}`);
  try {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await writeFile(probe, "agenttx", { mode: 0o600 });
    await rm(probe, { force: true });
    storeOk = true;
  } catch {
    storeOk = false;
  }
  const [repository, ...agents] = await Promise.all([
    repositoryHealth(cwd),
    probeAgent("claude", "Claude Code"),
    probeAgent("codex", "Codex"),
    probeAgent("gemini", "Gemini CLI"),
    probeAgent("opencode", "OpenCode")
  ]);
  const ready = nodeMajor >= 20 && gitOk && localClone && storeOk && repository.ok;
  const availableAgent = agents.find((agent) => agent.available);
  const next = ready
    ? [`agenttx run ${availableAgent?.id ?? "<your-agent>"}`]
    : [
        ...(nodeMajor < 20 ? ["Install Node.js 20 or newer."] : []),
        ...(!gitOk || !localClone ? ["Install a current Git release with local clone support."] : []),
        ...(!storeOk ? [`Make ${home} writable or set AGENTTX_HOME to a writable directory.`] : []),
        ...(!repository.ok ? [repository.message ?? "Move to a supported Git repository."] : [])
      ];
  return {
    schemaVersion: 1,
    ok: ready,
    node: { ok: nodeMajor >= 20, version: process.versions.node, requirement: ">=20" },
    git: { ok: gitOk, version: gitVersion, localClone },
    store: { ok: storeOk, writable: storeOk, path: home },
    repository,
    agents,
    platform: { name: process.platform, pathShims: process.platform === "win32" ? "best-effort" : "strong" },
    next
  };
}

export function renderDoctor(report: DoctorReport): string {
  const mark = (ok: boolean): string => (ok ? "✓" : "✗");
  const optional = (ok: boolean): string => (ok ? "✓" : "○");
  const lines = [
    "AgentTX Doctor",
    "",
    `  ${mark(report.node.ok)} Node.js ${report.node.version}`,
    `  ${mark(report.git.ok && report.git.localClone)} ${report.git.version}`,
    `  ${mark(report.repository.detected)} repository detected${report.repository.root ? ` (${report.repository.root})` : ""}`,
    `  ${mark(report.repository.hasCommits)} repository has commits`,
    `  ${mark(report.repository.supportedState)} repository state supported`,
    `  ${mark(report.store.ok)} transaction storage writable`,
    ...report.agents.map((agent) => `  ${optional(agent.available)} ${agent.label}${agent.version ? ` (${agent.version})` : " not detected"}`),
    `  ${optional(report.platform.pathShims === "strong")} PATH interception ${report.platform.pathShims} on ${report.platform.name}`,
    "",
    report.ok ? "✓ AgentTX ready" : "✗ AgentTX is not ready in this directory",
    "",
    "Next:",
    ...report.next.map((item) => `  ${item}`),
    "",
    "Repository isolation is real; command interception is heuristic, not a security boundary."
  ];
  return lines.join("\n");
}
