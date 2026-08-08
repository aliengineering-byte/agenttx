# LinkedIn launch draft

Coding agents are quickly moving from suggesting code to modifying entire repositories. I wanted a better primitive than simply trusting every change.

AgentTX gives AI coding agents Git-style transactions: run in isolation, inspect the result, then commit or roll back.

The original repository remains available while the agent works in an independent local clone. When the session ends, AgentTX summarizes the diff, selected side effects, risk, and verification checks. Acceptance refuses overlapping user changes; rejection removes the isolated transaction.

The first release is deliberately local and narrow: TypeScript CLI, MIT license, zero runtime dependencies, no telemetry, no cloud account, and an arbitrary-command interface that can sit around different agent CLIs.

It is also explicit about what it is not. AgentTX V0 is not an OS security boundary, its command interception is heuristic, and it cannot reverse arbitrary external-system changes. Its strong guarantee applies to transaction-relative repository state before acceptance.

As software agents become autonomous, execution needs transaction semantics.

Demo and source: [INSERT VERIFIED PUBLIC URL]
