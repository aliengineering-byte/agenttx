import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventLedger } from "../../src/core/ledger.js";

describe("append-only event ledger", () => {
  it("uses increasing sequence numbers and a hash chain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttx-ledger-"));
    const ledger = new EventLedger(directory);
    await ledger.initialize();
    await ledger.append("first", { value: 1 });
    await ledger.append("second", { value: 2 });
    const events = await ledger.read();
    expect(events.map((event) => event.seq)).toEqual([1, 2]);
    expect(events[1]?.previousHash).toBe(events[0]?.hash);
  });

  it("redacts values before persistence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttx-ledger-"));
    const ledger = new EventLedger(directory);
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz123456";
    await ledger.append("command", { token: secret, message: `token=${secret}` });
    expect(await readFile(ledger.path, "utf8")).not.toContain(secret);
  });

  it("ignores an incomplete final JSON line", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttx-ledger-"));
    const ledger = new EventLedger(directory);
    await ledger.append("complete", {});
    await appendFile(ledger.path, '{"schemaVersion":1');
    expect(await ledger.read()).toHaveLength(1);
  });

  it("repairs an incomplete final line before the next append", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttx-ledger-"));
    const ledger = new EventLedger(directory);
    await ledger.append("first", {});
    await appendFile(ledger.path, '{"schemaVersion":1');
    await ledger.append("second", {});
    expect((await ledger.read()).map((event) => event.type)).toEqual(["first", "second"]);
  });

  it("detects mutation of a completed event", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttx-ledger-"));
    const ledger = new EventLedger(directory);
    await ledger.append("complete", { safe: true });
    const content = (await readFile(ledger.path, "utf8")).replace('"safe":true', '"safe":false');
    await writeFile(ledger.path, content);
    await expect(ledger.read()).rejects.toThrow(/checksum mismatch/);
  });

  it("serializes concurrent appends", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agenttx-ledger-"));
    const ledger = new EventLedger(directory);
    await Promise.all(Array.from({ length: 12 }, (_, index) => ledger.append("parallel", { index })));
    expect((await ledger.read()).map((event) => event.seq)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });
});
