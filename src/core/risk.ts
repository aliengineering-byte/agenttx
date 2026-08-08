import type { DiffSummary, RiskAssessment, RiskReason, SecretFinding, SideEffectFinding } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

function addOnce(reasons: RiskReason[], points: number, reason: string): void {
  if (!reasons.some((item) => item.reason === reason)) reasons.push({ points, reason });
}

export function assessRisk(
  diff: DiffSummary,
  sideEffects: readonly SideEffectFinding[],
  secrets: readonly SecretFinding[]
): RiskAssessment {
  const reasons: RiskReason[] = [];
  const paths = diff.files.flatMap((file) => [file.path, ...(file.oldPath ? [file.oldPath] : [])]);
  if (diff.filesChanged > 20) addOnce(reasons, 1, `Many files changed (${diff.filesChanged})`);
  if (paths.some((path) => /(^|\/)package\.json$/i.test(path))) {
    addOnce(reasons, 2, "Dependency manifest changed");
  }
  if (paths.some((path) => /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock)$/i.test(path))) {
    addOnce(reasons, 2, "Dependency lockfile changed");
  }
  if (secrets.length) addOnce(reasons, 3, "Potential credential or secret path was touched");
  if (sideEffects.some((finding) => finding.category === "external_write" || finding.category === "remote_access")) {
    addOnce(reasons, 3, "External side effect detected");
  }
  if (sideEffects.some((finding) => finding.category === "destructive")) {
    addOnce(reasons, 4, "Destructive command detected");
  }
  if (sideEffects.some((finding) => finding.category === "publish" || finding.category === "deploy")) {
    addOnce(reasons, 5, "Publish or deployment operation detected");
  }
  const score = reasons.reduce((total, reason) => total + reason.points, 0);
  const level = score >= 9 ? "CRITICAL" : score >= 6 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW";
  return { schemaVersion: SCHEMA_VERSION, score, level, reasons };
}
