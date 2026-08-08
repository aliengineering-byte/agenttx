# AgentTX: transaction infrastructure for autonomous agents

## Problem

Software agents are gaining permission to change code, dependencies, infrastructure, and external systems. Their value comes from autonomy; their risk comes from results that are allowed yet wrong.

## Current gap

Permissions answer **can the agent act?** Teams also need **what happened, can we inspect it, and what happens when the result is wrong?** Sandboxing and observability are valuable, but neither alone creates an acceptance and rollback lifecycle for supported state.

## Product

AgentTX adds transaction semantics around autonomous work: begin, isolate, observe, inspect, verify, accept, or rollback. The open-source V0 gives coding agents Git-style repository transactions with conflict-safe acceptance, local history, deterministic risk, and redacted reports. It does not overclaim OS containment.

## Wedge

Coding agents plus Git repositories offer immediate developer pain, a precise state model, and a local-first adoption path. AgentTX wraps arbitrary commands, so growth in Claude, Codex, Gemini, OpenCode, and future agents expands the category rather than choosing a model-vendor winner.

## Expansion

User evidence can justify faster repository isolation, network approvals, OS/process isolation, database and cloud transaction adapters, MCP actions, and agent-native hooks. Each surface must define honest acceptance, rollback, or compensation semantics.

## Distribution and enterprise path

Developers adopt an MIT-licensed CLI locally without an account, telemetry, or cloud dependency. The strongest signal is repeated real work and voluntary rollback, not passive installs alone. If teams standardize the lifecycle, they may require shared policy, approvals, audit retention, agent identity, and central governance.

## Thesis

**As software agents become autonomous, execution needs transaction semantics.** AgentTX begins as a Git transaction wrapper and can grow into control infrastructure for autonomous software agents without pretending V0 already is that platform.
