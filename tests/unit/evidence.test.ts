import { describe, expect, it } from "vitest";
import {
  canonicalSha256,
  canonicalStringify,
  deriveWorkspaceStatusUnchanged
} from "../../src/core/evidence.js";

describe("evidence integrity primitives", () => {
  it("canonicalizes object keys by code-unit order independent of insertion order", () => {
    const first = { z: 1, A: { beta: true, alpha: false }, a: 2 };
    const second = { a: 2, A: { alpha: false, beta: true }, z: 1 };
    expect(canonicalStringify(first)).toBe(canonicalStringify(second));
    expect(canonicalSha256(first)).toBe(canonicalSha256(second));
    expect(canonicalStringify(first)).toBe('{"A":{"alpha":false,"beta":true},"a":2,"z":1}');
  });

  it("derives workspace status exclusively from before and after digests", () => {
    const digest = "a".repeat(64);
    expect(deriveWorkspaceStatusUnchanged(digest, digest)).toBe(true);
    expect(deriveWorkspaceStatusUnchanged(digest, "b".repeat(64))).toBe(false);
    expect(deriveWorkspaceStatusUnchanged(null, digest)).toBeNull();
  });
});
