import { describe, expect, it } from "vitest";
import { detectSideEffect, shouldBlockFinding } from "../../src/detectors/side-effects.js";
import { isLikelySecretPath } from "../../src/detectors/secrets.js";
import { assessRisk } from "../../src/core/risk.js";

describe("side-effect detection", () => {
  it.each([
    ["git", ["push", "origin", "main"], "external_write"],
    ["curl", ["-X", "DELETE", "https://example.test/item"], "external_write"],
    ["npm", ["publish"], "publish"],
    ["terraform", ["apply"], "deploy"],
    ["kubectl", ["delete", "pod", "api"], "deploy"],
    ["ssh", ["prod.example.test"], "remote_access"]
  ])("classifies %s", (command, args, category) => {
    expect(detectSideEffect(command, args)?.category).toBe(category);
  });

  it("does not classify ordinary local commands", () => {
    expect(detectSideEffect("git", ["status"])).toBeNull();
    expect(detectSideEffect("curl", ["https://example.test"])).toBeNull();
  });

  it("blocks by default and permits explicit external approval", () => {
    const result = detectSideEffect("git", ["push"]);
    expect(result).not.toBeNull();
    expect(shouldBlockFinding(result!, false)).toBe(true);
    expect(shouldBlockFinding(result!, true)).toBe(false);
  });
});

describe("secret paths and risk", () => {
  it.each([".env", ".env.local", ".ssh/id_ed25519", "prod.pem", ".aws/credentials"])(
    "recognizes %s",
    (path) => expect(isLikelySecretPath(path)).toBe(true)
  );

  it("produces transparent deterministic scoring", () => {
    const risk = assessRisk(
      {
        filesChanged: 2,
        additions: 3,
        deletions: 1,
        binaryFiles: 0,
        files: [
          { path: "package.json", kind: "modified", additions: 1, deletions: 1, binary: false },
          { path: ".env", kind: "added", additions: 2, deletions: 0, binary: false }
        ]
      },
      [{ category: "external_write", severity: "high", confidence: 0.99, reason: "push", evidence: "git push", blocked: true }],
      [{ category: "secret_file_changed", severity: "high", path: ".env", reason: "secret", value: "[REDACTED]" }]
    );
    expect(risk.score).toBe(8);
    expect(risk.level).toBe("HIGH");
    expect(risk.reasons).toHaveLength(3);
  });
});
