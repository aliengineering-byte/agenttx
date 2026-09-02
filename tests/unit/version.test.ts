import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VERSION } from "../../src/version.js";

describe("package identity", () => {
  it("keeps the public code version aligned with package.json", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
