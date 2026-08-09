# Reddit launch

## Primary title

I built a transaction layer so I can roll back a Claude Code/Codex session instead of trusting every change

## Primary post

I've been using coding agents for larger changes, and one thing bothered me: an agent can change a surprising amount of a repository before I know whether I want the session's result.

So I built AgentTX.

Instead of running an agent directly:

```bash
claude
```

you can put a transaction boundary around the command:

```bash
agenttx run claude
```

The agent works in an independent local Git transaction. After it exits:

```bash
agenttx diff
agenttx inspect
agenttx commit
# or
agenttx rollback
```

The original working tree stays unchanged until acceptance. AgentTX also preserves dirty baseline state and refuses acceptance if the same original path changed while the agent was running.

The real offline demo changes seven fixture files, safely attempts a simulated push, reports the transaction as HIGH risk, then rolls the entire session back. The original repository finishes clean.

Important limitation: this is repository transaction isolation, not an OS sandbox. The child still has normal user permissions, external-command detection is heuristic, and a real remote side effect is not inherently reversible.

AgentTX v0.1.0 is MIT licensed, local-first, on npm, and has no telemetry or runtime dependencies.

Demo/source: https://github.com/aliengineering-byte/agenttx

npm: https://www.npmjs.com/package/agenttx

I'd appreciate blunt feedback, especially from people using coding agents on real projects. If normal branches or worktrees already cover your workflow, that comparison is useful too.

## Community variants

### Programming / general engineering

**Title:** Show: a Git transaction lifecycle around arbitrary coding-agent commands

AgentTX packages Git primitives into an agent-oriented lifecycle: capture the dirty baseline, run in an independent clone, record a ledger, inspect the diff and side-effect findings, then accept or roll back with overlap checks. The generic interface is `agenttx run <command...>`. It is deliberately not an OS sandbox. I would value architectural criticism, especially around clone-versus-worktree tradeoffs: https://github.com/aliengineering-byte/agenttx

### Open source

**Title:** AgentTX v0.1.0 is open source — looking for real agent compatibility reports

I released a small MIT-licensed CLI that runs coding agents inside local repository transactions. The core workflow is tested across Windows, Linux, and macOS, but named agent CLIs have not all received real interactive smoke tests. I'm looking for reproducible compatibility reports and focused contributions rather than feature requests detached from use: https://github.com/aliengineering-byte/agenttx

### Claude Code / Codex users

**Title:** Would you put a commit/rollback boundary around higher-risk coding-agent sessions?

AgentTX can wrap an installed `claude`, `codex`, or any other executable without private vendor hooks. The agent works in an isolated repository transaction; afterward you diff, inspect, commit, or roll back. Named CLI behavior still needs real version-and-platform reports, so I am not claiming every interactive mode is tested. Demo and compatibility template: https://github.com/aliengineering-byte/agenttx

### Local developer tooling

**Title:** A local-first transaction wrapper for coding agents — no cloud or telemetry

AgentTX keeps transaction metadata, diffs, and history on the machine. It uses an independent Git clone to isolate repository state and requires no AgentTX account, API key, daemon, or telemetry service. The limitation is equally local: it is not an OS sandbox, and child processes retain normal permissions. Source and 13.8-second demo: https://github.com/aliengineering-byte/agenttx

## Posting note

Read each community's self-promotion and title rules first. Use only the most relevant variant, participate in the discussion, and do not cross-post identical copy across several communities at once.
