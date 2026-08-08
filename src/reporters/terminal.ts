import type { DiffSummary, RiskLevel, TransactionInspection, TransactionMetadata, VerificationReport } from "../core/types.js";

const useColor = Boolean(process.stdout.isTTY && !("NO_COLOR" in process.env) && !process.env.CI);
const ansi = {
  bold: (value: string): string => (useColor ? `\u001B[1m${value}\u001B[0m` : value),
  dim: (value: string): string => (useColor ? `\u001B[2m${value}\u001B[0m` : value),
  green: (value: string): string => (useColor ? `\u001B[32m${value}\u001B[0m` : value),
  yellow: (value: string): string => (useColor ? `\u001B[33m${value}\u001B[0m` : value),
  red: (value: string): string => (useColor ? `\u001B[31m${value}\u001B[0m` : value),
  magenta: (value: string): string => (useColor ? `\u001B[35m${value}\u001B[0m` : value),
  cyan: (value: string): string => (useColor ? `\u001B[36m${value}\u001B[0m` : value)
};

function riskColor(level: RiskLevel, value: string): string {
  if (level === "LOW") return ansi.green(value);
  if (level === "MEDIUM") return ansi.yellow(value);
  if (level === "HIGH") return ansi.red(value);
  return ansi.magenta(value);
}

export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) return "—";
  if (durationMs < 1_000) return `${durationMs}ms`;
  const seconds = Math.floor(durationMs / 1_000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${String(seconds % 60).padStart(2, "0")}s` : `${seconds}s`;
}

function row(label: string, value: string): string {
  return `  ${label.padEnd(14)}${value}`;
}

function verificationSummary(report: VerificationReport): string {
  if (!report.checks.length) return "No checks detected";
  const passed = report.checks.filter((item) => item.status === "passed").length;
  const failed = report.checks.filter((item) => item.status === "failed").length;
  const detected = report.checks.filter((item) => item.status === "detected").length;
  if (failed) return `${failed} failed / ${passed} passed`;
  if (detected) return `${detected} detected, not run`;
  return `${passed}/${report.checks.length} passed`;
}

export function renderTransactionReport(inspection: TransactionInspection): string {
  const { metadata, diff, sideEffects, secrets, risk, verification } = inspection;
  const lines = [
    "",
    ansi.bold("╭──────────────────────────────────────────╮"),
    ansi.bold("│ AgentTX Transaction                      │"),
    ansi.bold(`│ ${metadata.transactionId.padEnd(40)} │`),
    ansi.bold("╰──────────────────────────────────────────╯"),
    "",
    row("Agent", metadata.agent),
    row("Duration", formatDuration(metadata.durationMs)),
    row("Exit", metadata.exitCode === null || metadata.exitCode === undefined ? "—" : String(metadata.exitCode)),
    row("State", metadata.status),
    "",
    ansi.bold("Changes"),
    `  ${diff.filesChanged} file${diff.filesChanged === 1 ? "" : "s"}`,
    `  ${ansi.green(`+${diff.additions}`)} / ${ansi.red(`-${diff.deletions}`)}`,
    "",
    ansi.bold("Verification"),
    `  ${verificationSummary(verification)}`,
    "",
    ansi.bold("Side Effects")
  ];
  if (!sideEffects.length && !secrets.length) lines.push("  None detected by V0 heuristics");
  for (const finding of sideEffects) {
    lines.push(`  ${finding.blocked ? "🛑" : "⚠"} ${finding.reason} ${finding.blocked ? "[BLOCKED]" : "[ALLOWED]"}`);
  }
  for (const finding of secrets) lines.push(`  ⚠ ${finding.reason}  Value: [REDACTED]`);
  lines.push("", ansi.bold("Risk"), `  ${riskColor(risk.level, risk.level)} (${risk.score})`);
  for (const reason of risk.reasons) lines.push(`  • ${reason.reason} (+${reason.points})`);
  lines.push(
    "",
    ansi.bold("Next"),
    `  agenttx diff ${metadata.transactionId}`,
    `  agenttx inspect ${metadata.transactionId}`,
    `  agenttx verify ${metadata.transactionId}`,
    `  agenttx commit ${metadata.transactionId}`,
    `  agenttx rollback ${metadata.transactionId}`,
    "",
    ansi.dim("Detection is heuristic. AgentTX V0 is not an OS security sandbox.")
  );
  return lines.join("\n");
}

export function renderDiffSummary(diff: DiffSummary): string {
  const lines = [
    ansi.bold(`${diff.filesChanged} file${diff.filesChanged === 1 ? "" : "s"} changed`),
    `${ansi.green(`+${diff.additions}`)} ${ansi.red(`-${diff.deletions}`)}${diff.binaryFiles ? `  ${diff.binaryFiles} binary` : ""}`
  ];
  const sections: Array<[string, typeof diff.files]> = [
    ["Modified", diff.files.filter((file) => file.kind === "modified")],
    ["Added", diff.files.filter((file) => file.kind === "added")],
    ["Deleted", diff.files.filter((file) => file.kind === "deleted")],
    ["Renamed", diff.files.filter((file) => file.kind === "renamed")]
  ];
  for (const [title, files] of sections) {
    if (!files.length) continue;
    lines.push("", ansi.bold(title));
    for (const file of files) {
      lines.push(`  ${file.oldPath ? `${file.oldPath} → ` : ""}${file.path}`);
    }
  }
  return lines.join("\n");
}

export function renderStatus(metadata: TransactionMetadata): string {
  const command = [metadata.command.command, ...metadata.command.args].join(" ");
  return [
    ansi.bold(`AgentTX ${metadata.transactionId}`),
    row("State", metadata.status),
    row("Workspace", metadata.repositoryRoot),
    row("Command", command),
    row("Created", metadata.createdAt),
    row("Exit", metadata.exitCode === null || metadata.exitCode === undefined ? "—" : String(metadata.exitCode)),
    metadata.interrupted ? "  Recovered interrupted transaction. Resume is unsupported in V0." : ""
  ].filter(Boolean).join("\n");
}

export function renderHistory(items: readonly TransactionMetadata[]): string {
  if (!items.length) return "No AgentTX transactions recorded.";
  const lines = [ansi.bold("AgentTX transaction history")];
  for (const item of items) {
    lines.push(`${item.transactionId}  ${item.status.padEnd(11)}  ${item.agent.padEnd(9)}  ${item.createdAt}`);
  }
  return lines.join("\n");
}

export function renderVerification(report: VerificationReport): string {
  if (!report.checks.length) return "No common verification commands detected.";
  const lines = [ansi.bold("Detected verification")];
  for (const item of report.checks) {
    const marker = item.status === "passed" ? ansi.green("✓") : item.status === "failed" ? ansi.red("✗") : "○";
    lines.push(`  ${marker} ${item.command} ${item.args.join(" ")}  [${item.status}]`);
  }
  return lines.join("\n");
}

export { ansi };
