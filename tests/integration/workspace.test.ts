import { readFile, readlink, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { commitTransaction, inspectDiff, recoverInterruptedTransactions, rollbackTransaction } from "../../src/core/workspace.js";
import { createTransaction } from "../../src/core/workspace.js";
import { transitionTransaction, writeMetadata } from "../../src/core/store.js";
import type { CommandSpec } from "../../src/core/types.js";
import { createRepository, git, isolatedHome, runNodeTransaction, text } from "../helpers.js";

beforeEach(async () => {
  await isolatedHome();
});

describe("Git transaction workspace", () => {
  it("rolls back modifications, additions, and deletions without touching the original", async () => {
    const repository = await createRepository({ "a.txt": "before-a\n", "delete.txt": "keep me\n" });
    const source = `const fs=require('node:fs');fs.writeFileSync('a.txt','after-a\\n');fs.writeFileSync('new.txt','new\\n');fs.unlinkSync('delete.txt')`;
    const metadata = await runNodeTransaction(repository, source);
    const diff = await inspectDiff(metadata);
    expect(diff.files.map((file) => [file.path, file.kind])).toEqual([
      ["a.txt", "modified"],
      ["delete.txt", "deleted"],
      ["new.txt", "added"]
    ]);
    expect(await text(join(repository, "a.txt"))).toBe("before-a\n");
    const result = await rollbackTransaction(metadata);
    expect(result.metadata.status).toBe("ROLLED_BACK");
    expect(await text(join(repository, "a.txt"))).toBe("before-a\n");
    expect(await text(join(repository, "delete.txt"))).toBe("keep me\n");
    expect((await git(repository, ["status", "--porcelain"])).trim()).toBe("");
  });

  it("commits transaction changes while preserving unrelated concurrent edits", async () => {
    const repository = await createRepository({ "a.txt": "a0\n", "dirty.txt": "d0\n", "other.txt": "o0\n" });
    await writeFile(join(repository, "dirty.txt"), "d1 staged\n");
    await git(repository, ["add", "dirty.txt"]);
    const source = `const fs=require('node:fs');fs.writeFileSync('a.txt','a1 tx\\n');fs.writeFileSync('dirty.txt','d2 tx\\n')`;
    const metadata = await runNodeTransaction(repository, source);
    await writeFile(join(repository, "other.txt"), "o1 user\n");
    const result = await commitTransaction(metadata);
    expect(result.metadata.status).toBe("COMMITTED");
    expect(await text(join(repository, "a.txt"))).toBe("a1 tx\n");
    expect(await text(join(repository, "dirty.txt"))).toBe("d2 tx\n");
    expect(await text(join(repository, "other.txt"))).toBe("o1 user\n");
    expect(await git(repository, ["show", ":dirty.txt"])).toBe("d1 staged\n");
  });

  it("stops commit on an overlapping user edit and applies nothing", async () => {
    const repository = await createRepository({ "a.txt": "a0\n", "b.txt": "b0\n" });
    const metadata = await runNodeTransaction(repository, `const fs=require('node:fs');fs.writeFileSync('a.txt','agent\\n');fs.writeFileSync('b.txt','agent-b\\n')`);
    await writeFile(join(repository, "a.txt"), "user\n");
    await expect(commitTransaction(metadata)).rejects.toThrow(/Commit stopped/);
    expect(await text(join(repository, "a.txt"))).toBe("user\n");
    expect(await text(join(repository, "b.txt"))).toBe("b0\n");
  });

  it("preserves a dirty baseline and an untracked file through rollback", async () => {
    const repository = await createRepository({ "tracked.txt": "base\n" });
    await writeFile(join(repository, "tracked.txt"), "preexisting dirty\n");
    await writeFile(join(repository, "untracked.txt"), "preexisting untracked\n");
    const metadata = await runNodeTransaction(repository, `require('node:fs').writeFileSync('tracked.txt','agent edit\\n')`);
    await rollbackTransaction(metadata);
    expect(await text(join(repository, "tracked.txt"))).toBe("preexisting dirty\n");
    expect(await text(join(repository, "untracked.txt"))).toBe("preexisting untracked\n");
    const status = await git(repository, ["status", "--porcelain"]);
    expect(status).toContain(" M tracked.txt");
    expect(status).toContain("?? untracked.txt");
  });

  it("recognizes exact renames and binary modifications", async () => {
    const repository = await createRepository({ "old.txt": "same bytes\n", "image.bin": Buffer.from([0, 1, 2, 3]) });
    const command: CommandSpec = { command: process.execPath, args: ["-e", "process.exit(0)"] };
    let metadata = await createTransaction(repository, command, { allowExternal: false, agent: "test" });
    await rename(join(metadata.worktree, "old.txt"), join(metadata.worktree, "new.txt"));
    await writeFile(join(metadata.worktree, "image.bin"), Buffer.from([0, 9, 8, 7]));
    metadata = await transitionTransaction(metadata, "RUNNING");
    metadata = await transitionTransaction(metadata, "REVIEW");
    const diff = await inspectDiff(metadata);
    expect(diff.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "new.txt", oldPath: "old.txt", kind: "renamed" }),
      expect.objectContaining({ path: "image.bin", kind: "modified", binary: true })
    ]));
    await rollbackTransaction(metadata);
  });

  it.skipIf(process.platform === "win32")("preserves symbolic-link changes through commit", async () => {
    const repository = await createRepository({ "target-a.txt": "a\n", "target-b.txt": "b\n" });
    await symlink("target-a.txt", join(repository, "current.txt"));
    await git(repository, ["add", "current.txt"]);
    await git(repository, ["-c", "user.name=AgentTX Test", "-c", "user.email=test@agenttx.local", "commit", "-q", "-m", "add symlink"]);
    const source = `const fs=require('node:fs');fs.unlinkSync('current.txt');fs.symlinkSync('target-b.txt','current.txt')`;
    const metadata = await runNodeTransaction(repository, source);
    await commitTransaction(metadata);
    expect(await readlink(join(repository, "current.txt"))).toBe("target-b.txt");
  });

  it("recovers a dead RUNNING transaction into REVIEW", async () => {
    const repository = await createRepository();
    const command: CommandSpec = { command: process.execPath, args: ["-e", "process.exit(0)"] };
    let metadata = await createTransaction(repository, command, { allowExternal: false, agent: "test" });
    await writeFile(join(metadata.worktree, "file.txt"), "after crash\n");
    metadata = await transitionTransaction(metadata, "RUNNING", { parentPid: 2_147_483_647 });
    await writeMetadata(metadata);
    const recovered = await recoverInterruptedTransactions();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({ status: "REVIEW", interrupted: true, exitCode: null });
  });

  it("leaves tracked files intact when the child exits non-zero", async () => {
    const repository = await createRepository();
    const metadata = await runNodeTransaction(repository, `require('node:fs').writeFileSync('file.txt','changed\\n');process.exit(9)`);
    expect(metadata.status).toBe("REVIEW");
    expect(metadata.exitCode).toBe(9);
    expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("before\n");
  });
});
