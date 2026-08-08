import { basename } from "node:path";
import { sanitizeCommand } from "../core/redaction.js";
import type { SideEffectFinding } from "../core/types.js";

function toolName(command: string): string {
  return basename(command).replace(/\.(?:exe|cmd|bat|ps1)$/i, "").toLowerCase();
}

function finding(
  category: SideEffectFinding["category"],
  severity: SideEffectFinding["severity"],
  confidence: number,
  reason: string,
  evidence: string
): SideEffectFinding {
  return { category, severity, confidence, reason, evidence, blocked: false };
}

export function detectSideEffect(command: string, args: readonly string[]): SideEffectFinding | null {
  const safe = sanitizeCommand(command, args);
  const evidence = [safe.command, ...safe.args].join(" ");
  const tool = toolName(command);
  const lowerArgs = args.map((arg) => arg.toLowerCase());
  const joined = lowerArgs.join(" ");

  if (tool === "git" && lowerArgs[0] === "push") {
    return finding("external_write", "high", 0.99, "git push can modify a remote repository", evidence);
  }
  if (tool === "gh") {
    const action = `${lowerArgs[0] ?? ""} ${lowerArgs[1] ?? ""}`;
    if (/^(?:pr|issue|release|repo) (?:create|delete|edit|merge|close|reopen)$/.test(action)) {
      return finding("external_write", "high", 0.97, "GitHub CLI command can modify remote state", evidence);
    }
    if (lowerArgs[0] === "api" && /(?:^|\s)(?:--method|-x)\s*(?:post|put|patch|delete)(?:\s|$)/i.test(joined)) {
      return finding("external_write", "high", 0.96, "GitHub API request uses a write method", evidence);
    }
  }
  if (tool === "curl") {
    const explicitWrite = /(?:^|\s)(?:-x|--request)\s*(?:post|put|patch|delete)(?:\s|$)/i.test(joined);
    const implicitWrite = lowerArgs.some((arg) => /^(?:-d|--data|--data-raw|--data-binary|--upload-file|-t)$/.test(arg));
    if (explicitWrite || implicitWrite) {
      return finding("external_write", "high", 0.95, "curl request can write to an external service", evidence);
    }
  }
  if (tool === "wget" && lowerArgs.some((arg) => /^(?:--post-data|--post-file|--method=|--body-data)/.test(arg))) {
    return finding("external_write", "high", 0.93, "wget request can write to an external service", evidence);
  }
  if (["npm", "pnpm", "yarn"].includes(tool) && lowerArgs.includes("publish")) {
    return finding("publish", "critical", 0.99, "Package publish modifies a public or private registry", evidence);
  }
  if (tool === "docker" && lowerArgs[0] === "push") {
    return finding("publish", "critical", 0.99, "docker push modifies a remote image registry", evidence);
  }
  if (tool === "terraform" && ["apply", "destroy"].includes(lowerArgs[0] ?? "")) {
    return finding("deploy", "critical", 0.99, "Terraform command can change external infrastructure", evidence);
  }
  if (tool === "kubectl" && ["apply", "create", "delete", "patch", "replace", "scale"].includes(lowerArgs[0] ?? "")) {
    return finding("deploy", "critical", 0.98, "kubectl command can change cluster state", evidence);
  }
  if (["aws", "gcloud", "az"].includes(tool)) {
    return finding("external_write", "high", 0.75, "Cloud CLI command may change external resources", evidence);
  }
  if (["ssh", "scp", "sftp"].includes(tool)) {
    return finding("remote_access", "high", 0.92, "Remote access command can cause effects outside the transaction", evidence);
  }
  if (tool === "rsync" && args.some((arg) => /(?:^[^/]+@[^:]+:|^[^/]+:)/.test(arg))) {
    return finding("remote_access", "high", 0.9, "rsync target appears to be remote", evidence);
  }
  const shellCommand = ["sh", "bash", "zsh", "fish", "cmd", "powershell", "pwsh"].includes(tool);
  if (shellCommand) {
    if (/\bgit\s+push\b/i.test(joined)) {
      return finding("external_write", "high", 0.86, "Shell command contains git push", evidence);
    }
    if (/\b(?:npm\s+publish|docker\s+push|terraform\s+(?:apply|destroy)|kubectl\s+(?:apply|delete))\b/i.test(joined)) {
      return finding("deploy", "critical", 0.84, "Shell command contains a publish or deployment operation", evidence);
    }
    if (/(?:rm\s+-[^\s]*r[^\s]*f\s+(?:\/|~)|remove-item\s+.*-recurse.*(?:[a-z]:\\|~))/i.test(joined)) {
      return finding("destructive", "critical", 0.92, "Shell command appears to recursively delete a broad path", evidence);
    }
  }
  if (tool === "rm" && lowerArgs.some((arg) => /^-[a-z]*r[a-z]*f|^-[a-z]*f[a-z]*r/.test(arg)) && args.some((arg) => arg === "/" || arg === "~")) {
    return finding("destructive", "critical", 0.99, "Recursive deletion targets a broad filesystem path", evidence);
  }
  return null;
}

export function shouldBlockFinding(findingValue: SideEffectFinding, allowExternal: boolean): boolean {
  if (findingValue.category === "destructive") return true;
  return !allowExternal;
}

export const SHIM_TOOLS = [
  "git",
  "gh",
  "curl",
  "wget",
  "npm",
  "pnpm",
  "yarn",
  "docker",
  "terraform",
  "kubectl",
  "aws",
  "gcloud",
  "az",
  "ssh",
  "scp",
  "sftp",
  "rsync",
  "rm"
] as const;
