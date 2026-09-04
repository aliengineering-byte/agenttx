import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { pathExists } from "../core/fs.js";
import { assertSafeRelativePath } from "../core/fs.js";
import type {
  ProofConfig,
  ProofRelatedEvidenceConfig,
  ProofValidatorConfig
} from "./types.js";

const MAX_VALIDATORS = 32;
const MAX_RELATED_EVIDENCE = 16;
const MAX_ARGV = 128;
const MAX_ARGUMENT_BYTES = 16 * 1024;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error(`${name} has unsupported fields: ${unexpected.join(", ")}.`);
}

function identifier(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(value)) {
    throw new Error(`${name} must be a 1-64 character identifier.`);
  }
  return value;
}

export function validateArgv(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ARGV) {
    throw new Error(`${name} must contain 1-${MAX_ARGV} arguments.`);
  }
  if (value.some((item) => typeof item !== "string" || item.includes("\0"))) {
    throw new Error(`${name} must contain only NUL-free strings.`);
  }
  const argv = value as string[];
  if (Buffer.byteLength(argv.join("\0")) > MAX_ARGUMENT_BYTES) {
    throw new Error(`${name} exceeds ${MAX_ARGUMENT_BYTES} bytes.`);
  }
  return [...argv];
}

function validator(value: unknown, index: number): ProofValidatorConfig {
  const item = record(value, `validators[${index}]`);
  exactKeys(item, ["id", "argv", "required", "timeoutMs", "shell"], `validators[${index}]`);
  if (typeof item.required !== "boolean") throw new Error(`validators[${index}].required must be boolean.`);
  if (item.shell !== undefined && typeof item.shell !== "boolean") {
    throw new Error(`validators[${index}].shell must be boolean.`);
  }
  if (
    item.timeoutMs !== undefined &&
    (!Number.isSafeInteger(item.timeoutMs) || (item.timeoutMs as number) < 100 || (item.timeoutMs as number) > 3_600_000)
  ) {
    throw new Error(`validators[${index}].timeoutMs must be between 100 and 3600000.`);
  }
  return {
    id: identifier(item.id, `validators[${index}].id`),
    argv: validateArgv(item.argv, `validators[${index}].argv`),
    required: item.required,
    ...(item.timeoutMs === undefined ? {} : { timeoutMs: item.timeoutMs as number }),
    ...(item.shell === undefined ? {} : { shell: item.shell as boolean })
  };
}

function relatedEvidence(value: unknown, index: number): ProofRelatedEvidenceConfig {
  const item = record(value, `relatedEvidence[${index}]`);
  exactKeys(item, ["producer", "version", "capability", "path", "verify", "required"], `relatedEvidence[${index}]`);
  for (const field of ["producer", "version", "capability", "path"] as const) {
    if (typeof item[field] !== "string" || !(item[field] as string).trim()) {
      throw new Error(`relatedEvidence[${index}].${field} must be a non-empty string.`);
    }
  }
  if (isAbsolute(item.path as string)) {
    throw new Error(`relatedEvidence[${index}].path must be relative to the transaction workspace.`);
  }
  assertSafeRelativePath(item.path as string);
  if (item.required !== undefined && typeof item.required !== "boolean") {
    throw new Error(`relatedEvidence[${index}].required must be boolean.`);
  }
  return {
    producer: item.producer as string,
    version: item.version as string,
    capability: item.capability as string,
    path: item.path as string,
    verify: validateArgv(item.verify, `relatedEvidence[${index}].verify`),
    ...(item.required === undefined ? {} : { required: item.required as boolean })
  };
}

export function parseProofConfig(value: unknown): ProofConfig {
  const config = record(value, "proof configuration");
  exactKeys(config, ["validators", "relatedEvidence"], "proof configuration");
  if (config.validators !== undefined && !Array.isArray(config.validators)) {
    throw new Error("validators must be an array.");
  }
  if (config.relatedEvidence !== undefined && !Array.isArray(config.relatedEvidence)) {
    throw new Error("relatedEvidence must be an array.");
  }
  const validators = (config.validators ?? []) as unknown[];
  const related = (config.relatedEvidence ?? []) as unknown[];
  if (validators.length > MAX_VALIDATORS) throw new Error(`At most ${MAX_VALIDATORS} validators are allowed.`);
  if (related.length > MAX_RELATED_EVIDENCE) {
    throw new Error(`At most ${MAX_RELATED_EVIDENCE} related evidence artifacts are allowed.`);
  }
  const parsedValidators = validators.map(validator);
  if (new Set(parsedValidators.map((item) => item.id)).size !== parsedValidators.length) {
    throw new Error("Validator IDs must be unique.");
  }
  return {
    validators: parsedValidators,
    relatedEvidence: related.map(relatedEvidence)
  };
}

export async function loadProofConfig(repositoryRoot: string, requestedPath?: string): Promise<ProofConfig> {
  const path = resolve(repositoryRoot, requestedPath ?? ".agenttx/proof.json");
  if (!requestedPath && !(await pathExists(path))) return { validators: [], relatedEvidence: [] };
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read proof configuration ${path}: ${(error as Error).message}`);
  }
  return parseProofConfig(value);
}
