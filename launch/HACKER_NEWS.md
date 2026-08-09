# Hacker News launch

## Title

Show HN: AgentTX – Git-style transactions for AI coding agents

## Post

I use coding agents increasingly often, and the thing I wanted was not another agent. I wanted a transaction boundary around the agent I already use.

So I built AgentTX.

```text
agenttx run <coding-agent>

agenttx diff
agenttx inspect
agenttx commit
# or
agenttx rollback
```

AgentTX runs the child command in an independent local Git transaction workspace. The original working tree stays available and unchanged until you accept the transaction. When the agent exits, AgentTX shows the diff, detected side effects, risk, and project verification commands. Acceptance checks touched paths for concurrent changes; rollback removes the isolated workspace.

The 13.8-second demo is fully local and deterministic. A fake coding agent changes seven real fixture files, including auth code, dependencies, a lockfile, and CI; deletes a legacy file; and safely attempts `git push origin main`. AgentTX gates the simulated push, rates the transaction HIGH, shows the diff, and verifies rollback left the original repository clean.

Important limitation: v0.1.0 is repository transaction isolation, not an OS sandbox. The child retains the invoking user's permissions. External-command detection is heuristic, and AgentTX cannot undo a real push or arbitrary remote side effect.

AgentTX is MIT licensed, has zero runtime dependencies and no telemetry, and requires Node.js 20+ plus Git. It wraps arbitrary executables rather than depending on private hooks from one agent vendor.

GitHub: https://github.com/aliengineering-byte/agenttx

npm: https://www.npmjs.com/package/agenttx

I would especially value reports from real coding-agent workflows: which CLI and OS you use, whether interactive execution behaves correctly, and where inspection or rollback changes what you are willing to delegate.

## Posting note

Submit the GitHub repository as the Show HN URL and use the body above as the first comment if the submission form does not accept a text body. Answer technical questions directly; do not repeat the post as marketing copy.
