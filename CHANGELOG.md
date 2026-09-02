# Changelog

All notable changes to AgentTX are documented here. The project follows Semantic Versioning.

## Unreleased

### Added

- Successful rollback now emits path-free, hash-linked evidence recording whether the Git-visible original workspace status changed during rollback.
- `agenttx evidence <transaction-id>` regenerates rollback evidence from the terminal ledger when the initial atomic artifact write is unavailable.
- `agenttx verify-evidence <file>` checks the canonical outer receipt digest and every offline-derivable invariant without claiming authentication.
- Workspace evidence now binds tracked diffs and untracked content fingerprints, and rollback metadata is bound into the terminal ledger event.

### Changed

- Bump the unreleased package identity to `0.2.0`.
- Pin CI checkout and Node setup actions to reviewed immutable commits.

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
- Release verifier covering clean rollback, dirty-repository acceptance, and concurrent-change refusal from the packed package.
- Scaled 100/1,000/10,000-file benchmark harness and documented launch measurements.
- Repository, agent, and storage diagnostics in `agenttx doctor`.
- Public launch documentation, safe examples, issue templates, and deterministic SVG demo assets.

### Fixed

- Ledger lock acquisition now tolerates another writer releasing the lock between inspection and stale-lock recovery.
- Concurrent acceptance errors explicitly state that existing work was not overwritten and provide next commands.
