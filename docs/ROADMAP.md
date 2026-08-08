# Public roadmap

No dates are promised. Post-launch evidence decides which branch comes next.

## Now

- Git repository transaction isolation
- dirty-baseline capture
- diff and structured inspection
- conflict-safe acceptance and rollback
- transaction history and recovery to review
- deterministic risk classification
- secret redaction
- terminal, JSON, and standalone HTML reports

## Next

- faster large-repository transactions using evaluated worktree, reflink, or copy-on-write strategies
- stronger command interception and approval brokerage
- network approval proxy
- OS/process isolation
- agent-native hooks where users demonstrate demand
- MCP transaction integration

## Later

- team policies and shared approvals
- central audit and retention controls
- agent identity
- enterprise control plane

Priority signals: setup-speed complaints point to workspace performance; protection gaps point to process isolation; repeated external actions point to approval enforcement; team demand points to policy; concentrated agent usage points to native hooks; frequent rollback points to deeper transaction lifecycle and history.
