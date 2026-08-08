# Why transactions for agents?

AI agents increasingly act on filesystems, GitHub, databases, cloud infrastructure, browsers, email, deployment systems, and MCP tools.

Traditional access control asks:

> Is this action allowed?

That remains essential, but it is incomplete for autonomous work. AgentTX adds another question:

> If we allow this action and the agent is wrong, what happens next?

## Permission is a prediction; a transaction is evidence

An allow/deny decision happens before the result exists. It predicts whether an action will be acceptable. Agents operate under uncertainty, so a permitted action can still be wrong, incomplete, or surprising.

A transaction creates a review boundary after execution:

1. **Isolation** — reversible effects occur away from accepted state.
2. **Observation** — real events are recorded without inventing visibility.
3. **Inspection** — changes, verification, and risk reasons become legible.
4. **Commit** — accepted effects cross the boundary deliberately.
5. **Rollback** — rejected reversible effects are discarded.

This is the pattern behind databases, Git, and infrastructure plans. Agent work needs the same primitive across more domains.

## Reversibility is not universal

File edits in an isolated workspace can be discarded. An email already sent cannot. A production deployment may be compensatable but not truly reversible. A payment may require a refund workflow with different semantics.

AgentTX therefore separates:

- **Reversible** effects: isolate, inspect, commit, or roll back.
- **Recoverable** effects: record a compensation strategy when one genuinely exists.
- **Irreversible external** effects: detect or mediate before execution and require approval where enforcement is technically available.

Calling every action reversible would destroy trust. Transaction adapters must state their real guarantees.

## The primitive before the platform

V0 implements one real adapter: a Git-backed filesystem transaction using an independent local clone. It does not ship fake database, cloud, browser, or MCP adapters. The architecture can grow toward them when each domain has credible isolation, commit, rollback, compensation, or approval semantics.

The long-term category is **transactional execution infrastructure for autonomous agents**.

The public hook is simpler:

> **Make AI agents undoable.**
