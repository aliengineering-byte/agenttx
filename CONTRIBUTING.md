# Contributing to AgentTX

AgentTX optimizes for trustworthy behavior over feature count. Changes that weaken rollback, conflict handling, privacy, or claim accuracy should not merge.

## Setup and release checks

Node.js 20+ and Git are required. Tests create disposable repositories under the operating-system temporary directory.

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run demo
npm run scan:secrets
npm run check:links
npm run release:verify
```

Use `npm run test:coverage` when a behavior change needs coverage evidence. Numeric coverage alone is not a release target.

## Architecture map

```text
src/cli/        commands and environment diagnostics
src/core/       repository transaction, state, ledger, acceptance, rollback
src/adapters/   generic command and named agent identification
src/detectors/  side-effect and secret-path heuristics
src/reporters/  terminal and standalone HTML output
tests/          real temporary Git repositories and focused unit tests
```

- Add a **detector** only for deterministic evidence. Return a reason, category, severity, confidence, and whether the action was gated. Add positive and negative fixtures.
- Add an **agent adapter** only when identification or command construction genuinely differs. Generic `agenttx run <command...>` remains the primary interface.
- Add a **reporter** from structured inspection data. Redact before persistence or rendering, and keep schema fields versioned.
- Change transaction code with behavior tests covering clean and dirty state, staged and untracked files, conflicts, failure recovery, and rollback boundaries as applicable.

## Pull requests

- Keep changes focused and explain the user-visible contract.
- Never put raw credential fixtures in source; assemble unmistakably fake test values at runtime.
- Update security and threat-model docs when a guarantee or limitation changes.
- Avoid runtime dependencies unless their maintenance and attack-surface cost is justified.
- Do not add telemetry.
- Run the repeatable [release checklist](docs/RELEASE_CHECKLIST.md) for release-sensitive changes.

## Safety review

Before requesting review, answer:

1. Can rollback touch anything outside the transaction directory?
2. Can acceptance overwrite a path changed after transaction start?
3. Can a failure leave partially applied original files?
4. Can a secret enter metadata, ledger, patch, report, or error output?
5. Does user-facing language claim more containment than the code provides?
6. Does the package contain only intended files?

Open an issue before implementing a new transaction adapter, OS sandbox, network proxy, policy language, or cloud feature. Define concrete prepare, observe, inspect, accept, rollback or compensation, and failure semantics first.
