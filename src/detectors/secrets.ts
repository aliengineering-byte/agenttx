import { basename, normalize } from "node:path";
import type { FileChange, SecretFinding } from "../core/types.js";

const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
  /(^|\/)\.aws\/(?:credentials|config)$/i,
  /(^|\/)\.ssh\/[^/]+$/i,
  /(?:^|\/)(?:credentials|secrets?)\.(?:json|ya?ml|toml)$/i,
  /\.(?:pem|p12|pfx|key)$/i
];

export function isLikelySecretPath(path: string): boolean {
  const portable = normalize(path).replaceAll("\\", "/");
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(portable));
}

export function detectSecretFiles(files: readonly FileChange[]): SecretFinding[] {
  const paths = new Set<string>();
  for (const file of files) {
    if (isLikelySecretPath(file.path)) paths.add(file.path);
    if (file.oldPath && isLikelySecretPath(file.oldPath)) paths.add(file.oldPath);
  }
  return [...paths].sort().map((path) => ({
    category: "secret_file_changed",
    severity: "high",
    path,
    reason: `Potential secret-bearing file changed (${basename(path)})`,
    value: "[REDACTED]"
  }));
}

export function detectSecretPathArguments(args: readonly string[]): SecretFinding[] {
  return args
    .filter((arg) => isLikelySecretPath(arg))
    .map(() => ({
      category: "secret_file_changed" as const,
      severity: "high" as const,
      reason: "Command referenced a path that commonly contains secrets",
      value: "[REDACTED]" as const
    }));
}
