# AgentTX V0 schemas

All machine-readable artifacts use `schemaVersion: 1`. Additive fields may appear in minor releases. Removing or changing field meaning requires a schema-version change.

## Transaction metadata

`agenttx status --json` and `metadata.json` use:

```json
{
  "schemaVersion": 1,
  "transactionId": "atx_20260808_153522_a81f",
  "createdAt": "2026-08-08T15:35:22.000Z",
  "updatedAt": "2026-08-08T15:43:01.000Z",
  "workspace": "/work/project",
  "repositoryRoot": "/work/project",
  "transactionDirectory": "/home/user/.agenttx/transactions/atx_...",
  "worktree": "/home/user/.agenttx/transactions/atx_.../workspace",
  "invocationDirectory": ".",
  "baselineCommit": "<git-object-id>",
  "baseHead": "<git-object-id>",
  "agent": "claude",
  "command": { "command": "claude", "args": [] },
  "status": "REVIEW",
  "allowExternal": false,
  "parentPid": 1234,
  "exitCode": 0
}
```

States are `CREATED`, `RUNNING`, `REVIEW`, `COMMITTED`, `ROLLED_BACK`, `FAILED`, and `ABORTED`.

Allowed transitions:

```text
CREATED  -> RUNNING | FAILED | ABORTED | ROLLED_BACK
RUNNING  -> REVIEW | FAILED | ABORTED
REVIEW   -> COMMITTED | ROLLED_BACK | FAILED
FAILED   -> REVIEW | ROLLED_BACK
ABORTED  -> REVIEW | ROLLED_BACK
```

`COMMITTED` and `ROLLED_BACK` are terminal.

## Event ledger

Each `events.jsonl` line is independently parseable JSON:

```json
{
  "schemaVersion": 1,
  "seq": 3,
  "type": "side_effect.blocked",
  "timestamp": "2026-08-08T15:40:00.000Z",
  "data": {
    "finding": {
      "category": "external_write",
      "severity": "high",
      "confidence": 0.99,
      "reason": "git push can modify a remote repository",
      "evidence": "git push origin main",
      "blocked": true
    }
  },
  "previousHash": "<sha256-or-null>",
  "hash": "<sha256>"
}
```

The digest covers every field except `hash`. `previousHash` chains completed events. An invalid middle line, sequence gap, chain mismatch, or checksum mismatch is corruption. A malformed final line without a newline is treated as an interrupted append; it is ignored on read and truncated under the ledger lock before the next append.

Event `data` is extensible. Consumers should branch on `type` and ignore unknown fields and types.

## Inspection

`agenttx inspect --json` returns:

```json
{
  "schemaVersion": 1,
  "metadata": { "schemaVersion": 1 },
  "diff": {
    "filesChanged": 2,
    "additions": 12,
    "deletions": 3,
    "binaryFiles": 0,
    "files": [
      {
        "path": "src/auth.ts",
        "kind": "modified",
        "additions": 12,
        "deletions": 3,
        "binary": false
      }
    ]
  },
  "sideEffects": [],
  "secrets": [],
  "risk": {
    "schemaVersion": 1,
    "score": 0,
    "level": "LOW",
    "reasons": []
  },
  "verification": {
    "schemaVersion": 1,
    "updatedAt": "2026-08-08T15:43:01.000Z",
    "checks": []
  },
  "eventCount": 5,
  "commandCount": 1
}
```

File `kind` is `added`, `modified`, `deleted`, or `renamed`. Binary line counts are `null`.

Risk `level` is `LOW`, `MEDIUM`, `HIGH`, or `CRITICAL`. Every score contribution appears in `reasons`.

Secret finding values are always the literal `[REDACTED]`.

## Rollback evidence

A successful `agenttx rollback` writes `rollback-evidence.json` in the transaction
directory and prints its location. If persistence fails, rollback remains complete
and the CLI prints `agenttx evidence <transaction-id>` as the regeneration path.
Evidence export accepts an existing byte-identical artifact but refuses to replace
different content, including at an explicit `--output` path.

The schema has an unsigned receipt plus an outer integrity record:

```json
{
  "receipt": {
    "schemaVersion": 1,
    "evidenceType": "agenttx.rollback",
    "producer": { "version": "0.2.0", "...": "..." },
    "transaction": { "state": "ROLLED_BACK", "...": "..." },
    "result": { "originalWorkspaceStatusUnchanged": true, "...": "..." },
    "workspaceStatusEvidence": {
      "algorithm": "sha256(agenttx-git-visible-content-v1)",
      "before": "<sha256>",
      "after": "<sha256>"
    },
    "eventChain": {
      "algorithm": "sha256(JSON.stringify(event))",
      "events": 7,
      "finalHash": "<sha256>",
      "terminalEvent": { "type": "rollback.completed", "...": "..." }
    },
    "artifacts": {
      "transactionDiff": { "sha256": "<sha256>", "...": "..." },
      "transactionMetadata": { "sha256": "<sha256>", "...": "..." }
    },
    "redaction": {
      "filePathsIncluded": false,
      "commandArgumentsIncluded": false,
      "privatePathsIncluded": false,
      "secrets": "redacted"
    },
    "limitations": ["..."]
  },
  "integrity": {
    "algorithm": "sha256",
    "canonicalization": "agenttx-canonical-json-v1",
    "scope": "receipt",
    "authentication": "none",
    "digest": "<sha256>"
  }
}
```

`agenttx-canonical-json-v1` serializes primitives with JSON rules, preserves array
order, and sorts object keys by explicit UTF-16 code-unit comparison. The outer
digest covers every field in `receipt`. `agenttx verify-evidence <file>` recomputes
that digest and checks strict field sets, formats and counts, the transaction
metadata digest, the terminal ledger event hash and cross-references, and the
workspace result derived from the before/after digests.

`originalWorkspaceStatusUnchanged` is never trusted as an independent assertion.
It is `null` if either workspace digest is unavailable; otherwise it is exactly
the equality result for those digests. `agenttx-git-visible-content-v1` commits to
Git `HEAD`, porcelain-v2 status, the full binary tracked diff relative to `HEAD`,
and sorted untracked path/content fingerprints. Only the digests are exported;
ignored files and external systems remain outside the receipt.

The terminal event binds the transaction ID, baseline/base object IDs, completion
time, discarded diff, and workspace digests without exporting commands, private
paths, or file names. The receipt is deliberately unsigned and recomputable. Its
hash detects accidental or partial alteration, but is not authentication and is
not proof against a party able to rewrite the complete local receipt and ledger.
