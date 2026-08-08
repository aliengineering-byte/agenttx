import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FileFingerprint } from "./types.js";

export function assertSafeRelativePath(path: string): void {
  if (!path || isAbsolute(path) || path.includes("\0")) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
  const normalized = path.replaceAll("\\", "/");
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Repository path escapes workspace: ${path}`);
  }
}

export function assertContained(parent: string, child: string): void {
  const parentPath = resolve(parent);
  const childPath = resolve(child);
  const relation = relative(parentPath, childPath);
  if (relation === "" || relation === ".") return;
  if (relation.startsWith("..") || isAbsolute(relation)) {
    throw new Error(`Path ${childPath} is outside ${parentPath}`);
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function fingerprintPath(path: string): Promise<FileFingerprint | null> {
  try {
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      return {
        type: "symlink",
        sha256: createHash("sha256").update(target).digest("hex"),
        size: Buffer.byteLength(target),
        mode: stat.mode & 0o777
      };
    }
    if (!stat.isFile()) return null;
    const content = await readFile(path);
    return {
      type: "file",
      sha256: createHash("sha256").update(content).digest("hex"),
      size: content.length,
      mode: stat.mode & 0o777
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function fingerprintsEqual(
  left: FileFingerprint | null | undefined,
  right: FileFingerprint | null | undefined,
  platform = process.platform
): boolean {
  if (!left || !right) return !left && !right;
  const modeMatches = platform === "win32" || left.mode === right.mode;
  return (
    left.type === right.type &&
    left.sha256 === right.sha256 &&
    left.size === right.size &&
    modeMatches
  );
}

export async function copyEntry(source: string, destination: string): Promise<void> {
  const stat = await lstat(source);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.agenttx-${process.pid}-${Date.now()}`;
  await rm(temporary, { force: true, recursive: true });
  if (stat.isSymbolicLink()) {
    const target = await readlink(source);
    await symlink(target, temporary);
  } else if (stat.isFile()) {
    await copyFile(source, temporary);
    await chmod(temporary, stat.mode & 0o777);
  } else {
    throw new Error(`Unsupported filesystem entry: ${source}`);
  }
  await rm(destination, { force: true, recursive: true });
  await rename(temporary, destination);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function toPosixPath(value: string): string {
  return sep === "/" ? value : value.replaceAll(sep, "/");
}
