import { describe, expect, it } from "vitest";
import { containsUnredactedSecret, redactText, redactValue, sanitizeCommand } from "../../src/core/redaction.js";

const secrets = [
  ["gh", "p_abcdefghijklmnopqrstuvwxyz123456"].join(""),
  ["s", "k-abcdefghijklmnopqrstuvwxyz123456"].join(""),
  ["AK", "IAIOSFODNN7EXAMPLE"].join("")
];

describe("secret redaction", () => {
  it.each(secrets)("redacts token pattern %s", (secret) => {
    const output = redactText(`token=${secret}`);
    expect(output).not.toContain(secret);
    expect(output).toContain("[REDACTED]");
  });

  it("redacts private key blocks and URL credentials", () => {
    const keyMarker = ["-----BEGIN", " PRIVATE KEY-----"].join("");
    const endMarker = ["-----END", " PRIVATE KEY-----"].join("");
    const input = `${keyMarker}\nprivate-data\n${endMarker} https://alice:hunter2@example.com`;
    const output = redactText(input);
    expect(output).not.toContain("private-data");
    expect(output).not.toContain("hunter2");
  });

  it("redacts sensitive object keys recursively", () => {
    expect(redactValue({ nested: { password: "hunter2", safe: "yes" } })).toEqual({
      nested: { password: "[REDACTED]", safe: "yes" }
    });
  });

  it("redacts split command flags", () => {
    const safe = sanitizeCommand("tool", ["--token", "super-secret-value", "--safe"]);
    expect(safe.args).toEqual(["--token", "[REDACTED]", "--safe"]);
  });

  it("detects text that still contains a known token", () => {
    expect(containsUnredactedSecret(secrets[0] ?? "")).toBe(true);
    expect(containsUnredactedSecret(redactText(secrets[0] ?? ""))).toBe(false);
  });
});
