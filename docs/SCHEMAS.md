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

A successful `agenttx rollback` writes `rollback-evidence.json` in the transaction directory and prints its location. If that final atomic write fails, rollback remains complete and the CLI prints an actionable warning; `agenttx evidence <transaction-id>` regenerates the artifact from `after.json` and the terminal event ledger. Evidence export accepts an existing byte-identical artifact but refuses to replace different content, including at an explicit `--output` path. The artifact is deliberately path-free by default:

```json
{
  "schemaVersion": 1,
  "evidenceType": "agenttx.rollback",
  "producer": {
    "repository": "aliengineering-byte/agenttx",
    "version": "0.1.0",
    "capability": "repository-transaction-rollback",
    "documentation": "https://github.com/aliengineering-byte/agenttx/blob/main/docs/SCHEMAS.md#rollback-evidence"
  },
  "transaction": {
    "transactionId": "atx_20260808_153522_a81f",
    "baselineCommit": "<git-object-id>",
    "baseHead": "<git-object-id>",
    "state": "ROLLED_BACK",
    "completedAt": "2026-08-08T15:43:01.000Z"
  },
  "result": {
    "filesDiscarded": 2,
    "additionsDiscarded": 12,
    "deletionsDiscarded": 3,
    "binaryFilesDiscarded": 0,
    "originalWorkspaceStatusUnchanged": true
  },
  "workspaceStatusEvidence": {
    "algorithm": "sha256(git-head-nul-status-porcelain-v2-z)",
    "before": "<sha256>",
    "after": "<sha256>"
  },
  "eventChain": {
    "algorithm": "sha256",
    "events": 7,
    "finalHash": "<sha256>"
  },
  "artifacts": {
    "transactionDiff": {
      "algorithm": "sha256(JSON.stringify(diff))",
      "sha256": "<sha256>"
    }
  },
  "redaction": {
    "filePathsIncluded": false,
    "commandArgumentsIncluded": false,
    "privatePathsIncluded": false,
    "secrets": "redacted"
  },
  "limitations": ["..."]
}
```

`originalWorkspaceStatusUnchanged` compares hashes of Git `HEAD` plus porcelain-v2 status immediately before and after isolated-workspace removal. It is `null` when the original repository cannot be inspected. It does not cover ignored files or external systems; AgentTX remains repository isolation, not an operating-system security boundary. The terminal event binds the path-free diff digest and workspace-status digests into the validated event chain without copying commands, file paths, or user content into the exported evidence.
