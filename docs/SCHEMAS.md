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
