# AgentTX v0.1.0

The first public release of AgentTX: Git-style transactions for AI coding agents.

AgentTX lets you run an arbitrary coding-agent command in an isolated repository transaction, inspect everything it changed, and then either accept or discard the result.

## Highlights

- independent no-hardlink Git clone with dirty, staged, unstaged, and non-ignored untracked baseline capture;
- interactive child-process execution and generic agent command support;
- file diff, deterministic risk, selected side-effect findings, and verification discovery;
- structured JSON, terminal, and standalone redacted HTML inspection;
- conflict-safe acceptance that preserves unrelated working-tree and index changes;
- rollback that removes only the isolated transaction workspace before acceptance;
- append-only hash-chained event history and interrupted-session recovery to review;
- deterministic seven-file demo with a safely gated simulated push;
- zero runtime dependencies, no telemetry, and no required cloud service or API key.

## Try it

```bash
npx agenttx doctor
npx agenttx run <your-agent-command>
npx agenttx inspect
npx agenttx commit   # accepts files; does not create a Git commit
# or: npx agenttx rollback
```

## Important limitations

AgentTX V0 is repository isolation, not an OS security boundary. The child retains normal user permissions. External-action detection is heuristic, can be bypassed, and cannot reverse a real push or arbitrary external-system change. Git submodules, active merge-like operations, resume, post-acceptance rollback, and ignored-file copying are unsupported. Independent clone setup and disk use scale with repository size.

Read the security model and threat model before using AgentTX around untrusted code.
