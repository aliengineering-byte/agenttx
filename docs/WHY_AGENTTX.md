# Why AgentTX

**As software agents become autonomous, execution needs transaction semantics.**

AI coding agents increasingly modify source code, dependencies, Git history, CI and cloud configuration, databases, and external services. More autonomy makes them useful, but it also makes a wrong result more consequential.

Existing permission systems mostly ask: **is this action allowed?** That question matters, but it is incomplete. An agent can be permitted, competent, and still produce a result the developer does not want.

AgentTX adds a second primitive: **what happened, can I inspect it, and what happens if the result is wrong?** For repository work, the lifecycle is:

```text
BEGIN → isolate → observe → inspect → verify → accept / rollback
```

V0 makes this concrete for Git repositories. The original working tree remains available while the agent operates in an independent clone. AgentTX records the session, summarizes file changes and selected side effects, discovers verification commands, and asks for an explicit acceptance decision. Conflicting user edits stop acceptance before transaction files are applied. Rejection deletes the isolated workspace.

This is narrower than general-purpose containment and more operational than observability alone. AgentTX does not claim to remove the process's OS permissions or reverse arbitrary external systems. Its strong V0 guarantee is about transaction-relative repository state before acceptance.

The open-source wedge is coding agents plus Git because the state model has observable baselines and meaningful commit/rollback behavior. The longer-term category is control infrastructure for autonomous agents: transaction semantics across code, network approvals, databases, cloud actions, and tool protocols—but only where each adapter can define honest acceptance, rollback, or compensation.

AgentTX is infrastructure around the agent ecosystem, not a competing agent. As Claude, Codex, Gemini, OpenCode, and future agents become more capable, the need for an independent review and acceptance layer grows.
