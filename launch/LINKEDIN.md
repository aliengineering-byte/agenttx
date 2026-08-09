# LinkedIn launch

Coding agents are quickly moving from suggesting code to modifying entire repositories.

The primitive I wanted was not another coding agent. It was a transaction boundary around the agents I already use.

So I built AgentTX: open-source, Git-style transactions for AI coding agents.

```text
agenttx run <coding-agent>
agenttx diff
agenttx inspect
agenttx commit
# or agenttx rollback
```

The agent runs in an independent local repository transaction. Your original working tree stays available and unchanged until you accept the result. After the session, you can inspect the complete diff, detected side effects, risk, and verification checks—then commit the good or roll back the whole transaction.

The first release is intentionally focused: local-first, MIT licensed, zero runtime dependencies, no telemetry, and available on npm.

It is also explicit about its boundary. AgentTX v0.1.0 is not an OS sandbox. Child processes retain normal user permissions, external-action detection is heuristic, and real remote side effects are not inherently reversible.

As agents gain autonomy, execution needs transaction semantics.

13.8-second demo and source: https://github.com/aliengineering-byte/agenttx

npm: https://www.npmjs.com/package/agenttx
