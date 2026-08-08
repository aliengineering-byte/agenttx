# Changelog

All notable changes to AgentTX are documented here. The project follows Semantic Versioning.

## [0.1.0] - 2026-08-08

### Added

- Independent no-hardlink Git clone transactions with dirty-baseline capture.
- Explicit transaction state machine and crash discovery.
- Interactive arbitrary-process runner with signal handling.
- Append-only, hash-chained JSONL event ledger.
- Diff summary, redacted unified patch, JSON inspection, and standalone HTML report.
- Conflict-safe acceptance that preserves unrelated working-tree and index changes.
- Rollback that removes only the isolated transaction workspace.
- Heuristic command-side-effect detection and default blocking for selected external writes.
- Secret-bearing path detection and recursive value redaction.
- Deterministic risk scoring and opt-in project verification.
- Deterministic offline demo and cross-platform CI definition.
