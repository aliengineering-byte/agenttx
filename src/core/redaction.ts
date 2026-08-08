const REDACTED = "[REDACTED]";

const SECRET_KEY = /^(?:.*[_-])?(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|private[_-]?key|credential|cookie)$/i;

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [
    /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
    REDACTED
  ],
  [/\b(?:gh[pousr]_[A-Za-z0-9_]{16,}|github_pat_[A-Za-z0-9_]{16,})\b/g, REDACTED],
  [/\bAKIA[A-Z0-9]{16}\b/g, REDACTED],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`],
  [/(https?:\/\/)([^\s\/:@]+):([^\s\/@]+)@/gi, `$1${REDACTED}:${REDACTED}@`],
  [
    /((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret|private[_-]?key|aws_secret_access_key)\s*[:=]\s*)["']?[^\s"',;]+["']?/gi,
    `$1${REDACTED}`
  ],
  [/(--(?:api-key|token|password|secret)(?:=|\s+))[^\s]+/gi, `$1${REDACTED}`]
];

export function redactText(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}

export function redactValue(value: unknown, key?: string): unknown {
  if (key && SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey)
      ])
    );
  }
  return value;
}

export function sanitizeCommand(command: string, args: readonly string[]): {
  command: string;
  args: string[];
} {
  const result: string[] = [];
  let redactNext = false;
  for (const arg of args) {
    if (redactNext) {
      result.push(REDACTED);
      redactNext = false;
      continue;
    }
    if (/^--(?:api-key|token|password|secret)$/i.test(arg)) {
      result.push(arg);
      redactNext = true;
      continue;
    }
    result.push(redactText(arg));
  }
  return { command: redactText(command), args: result };
}

export function containsUnredactedSecret(value: string): boolean {
  return TEXT_PATTERNS.some(([pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

export { REDACTED };
