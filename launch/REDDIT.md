# Reddit launch draft

## Suggested title

I built a transaction layer so I can roll back a Claude Code/Codex session instead of trusting every change

## Post

I have been using coding agents for larger edits, and the uncomfortable part is no longer whether they can write code. It is deciding whether a whole session deserves to land in my real working tree.

I built AgentTX around that decision. It runs any agent CLI in an isolated Git transaction, then gives you:

```bash
agenttx run <your-agent>
agenttx diff --full
agenttx inspect
agenttx commit
# or agenttx rollback
```

It captures dirty/staged/untracked baseline state, keeps the original repository available, and refuses acceptance if you changed an overlapping path while the agent was running. The offline demo also simulates an accidental `git push`, gates it, shows why the transaction is HIGH risk, and rolls back seven real file changes.

The honest limitation: AgentTX V0 is not an OS sandbox. The process still has my user permissions, and external-command interception is heuristic. It cannot undo an actual remote side effect. Its strong guarantee is about repository changes inside the transaction before I accept them.

It is MIT licensed, local-first, has zero runtime dependencies, no telemetry, and does not need an API key or cloud account. The generic `agenttx run <command...>` interface is deliberate; I do not want it tied to one agent company.

Repository: [INSERT VERIFIED PUBLIC URL]

I would appreciate blunt feedback, especially compatibility reports and cases where normal Git branches/worktrees already solve enough of this for you.

## Where it may fit

Consider developer-tool and local-first communities where self-posts are permitted. Read each community's rules, tailor the post, participate in discussion, and do not cross-post it as spam.
