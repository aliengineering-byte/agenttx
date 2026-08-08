# Competitive landscape by category

This note compares product categories, not individual vendors. Capabilities vary by product and version.

| Category | What it solves | Overlap with AgentTX | Key difference | Potential integration |
|---|---|---|---|---|
| Coding agents | Generate and modify software | Both participate in an agent session | The agent performs work; AgentTX wraps its repository work in a transaction | AgentTX can launch any agent CLI |
| Agent sandboxes | Isolate processes, filesystems, or OS capabilities | Both reduce blast radius | V0 isolates repository state, not the child's full OS authority | Run an AgentTX transaction inside a stronger sandbox |
| Agent firewalls | Allow, deny, or approve actions | Heuristic gates observe selected commands | Firewalls focus on permission; AgentTX focuses on begin, review, accept, and rollback | Feed findings into an approval broker |
| Agent observability | Explain what an agent did | AgentTX records events, risk, and reports | AgentTX also provides acceptance and rollback for supported state | Export structured inspection to observability systems |
| Code-review agents | Analyze or comment on code changes | Both help evaluate diffs | Review agents judge changes; AgentTX owns the transaction boundary and user decision | Run review checks before acceptance |
| Git branches/worktrees | Isolate code histories or working trees | Git is AgentTX's V0 state substrate | AgentTX adds dirty-state capture, agent execution, metadata, risk, verification, history, reporting, and conflict-safe acceptance | Git strategies can improve setup performance |
| AgentTX | Transaction lifecycle for agent work | — | Repository isolation plus inspect, verify, accept, or rollback | Compose with every category above |

The positioning is not that these categories are inadequate. They answer different questions. AgentTX's question is: **if an allowed agent completed work, can the developer make an informed, atomic acceptance decision?**
