# Contributing to AgentTX

AgentTX optimizes for trustworthy behavior over feature count. A change that weakens rollback, conflict handling, privacy, or claim accuracy should not merge.

## Set up

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

Node.js 20+ and Git are required. Tests create disposable repositories under the operating-system temporary directory.

## Pull requests

- Keep changes focused on the transaction primitive.
- Add behavior tests using real Git operations when changing isolation, diff, acceptance, rollback, or recovery.
- Test clean, dirty, staged, unstaged, and untracked states affected by the change.
- Add negative tests for conflicts and interrupted operations.
- Never put raw credential fixtures in source. Use unmistakably fake values that still exercise redaction patterns.
- Update the security model when a guarantee or limitation changes.
- Avoid runtime dependencies unless the maintenance and attack-surface cost is justified.
- Do not add telemetry.

## Safety review checklist

Before requesting review, answer:

1. Can rollback touch anything outside the transaction directory?
2. Can acceptance overwrite a path changed after transaction start?
3. Can a failure leave partially applied original files?
4. Can a secret enter metadata, ledger, patch, report, or error output?
5. Does terminal or README language claim more containment than the code provides?
6. Does the package contain only intended release files?

## Design proposals

Open an issue before implementing a new transaction adapter, policy language, OS sandbox, network proxy, or cloud feature. The proposal must define actual prepare, observe, inspect, commit, rollback, compensation, and failure semantics. Interfaces without a real implementation are intentionally deferred.
