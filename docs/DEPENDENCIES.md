# Dependency and license record

AgentTX v0.1.0 has **zero runtime dependencies**.

The release environment resolved these direct development dependencies from `package-lock.json`:

| Package | Resolved version | License | Purpose |
|---|---:|---|---|
| `@types/node` | 24.13.3 | MIT | Node.js type definitions |
| `@vitest/coverage-v8` | 4.1.10 | MIT | Development-only coverage reporting |
| `typescript` | 7.0.2 | Apache-2.0 | Compiler and type checking |
| `vitest` | 4.1.10 | MIT | Test runner |

Licenses were read from the resolved lockfile metadata and spot-checked against the public registry during release preparation on 2026-08-08. Both MIT and Apache-2.0 are compatible with this repository's MIT distribution. Transitive dependencies remain governed by `package-lock.json` and should be re-audited on dependency updates.
