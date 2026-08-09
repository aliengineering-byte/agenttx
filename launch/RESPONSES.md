# AgentTX launch response bank

Use these as factual starting points, not canned replies. Answer the specific question first and link deeper documentation only when useful.

## Why not just Git?

Git provides the underlying state and isolation primitives. AgentTX packages them into an agent-oriented lifecycle: capture the dirty baseline, isolate and run the child, record a ledger, inspect and risk-classify the result, discover verification commands, accept with conflict checks, or roll back, with transaction history afterward. If a manual Git workflow already covers your needs, use it; AgentTX is workflow and semantics around Git, not a replacement for Git.

## Why not Git worktrees?

Linked worktrees share the original repository's object database. An agent that stages secret-bearing content can leave an object in that shared store even after the worktree is removed. AgentTX v0.1.0 uses an independent `--no-hardlinks` clone so transaction objects and refs live inside the transaction directory. The tradeoff is additional setup time and disk use.

## Why not Docker?

Containers solve a different layer. AgentTX provides transaction semantics around agent work: inspect, verify, commit, rollback, ledger, and conflict detection. Container or OS isolation could complement AgentTX; it does not replace the transaction lifecycle.

## Is this actually a sandbox?

No, not in v0.1.0. AgentTX isolates supported repository state, but the child process still has your normal OS permissions. External-command detection and gating are heuristic. Stronger OS and network isolation are roadmap directions, not current guarantees.

## Can it undo `git push`?

No. Remote side effects are not inherently reversible. AgentTX may detect and gate selected commands, but its strong rollback guarantee in v0.1.0 applies to isolated repository transaction state. The demo's push is simulated and blocked; no real remote is contacted.

## Why not just review `git diff`?

Reviewing a diff is part of the workflow, but it happens after changes already reached whichever workspace the agent used. AgentTX keeps the original working tree available, captures dirty baseline state, records side-effect and risk evidence, discovers project checks, protects overlapping original changes during acceptance, and lets rejection remove the whole isolated transaction.

## Does it work with dirty repositories?

Yes, with defined limits. AgentTX overlays tracked changes plus non-ignored untracked files into the transaction baseline while leaving the original index and working tree in place. Ignored files are not copied. Unrelated later changes are preserved; overlapping changes cause acceptance to stop before applying transaction files.

## Does it upload my code?

AgentTX v0.1.0 has no service backend or telemetry and does not upload code, paths, prompts, commands, diffs, credentials, or transaction metadata. The child agent remains a separate program and can use its own network capabilities according to that tool and your environment.

## Does it work with Claude Code?

AgentTX can launch an installed `claude` executable and identifies it for reporting. The stable interface is generic command wrapping, not private Claude hooks. Real interactive compatibility varies by CLI version, OS, and terminal behavior; the project is collecting explicit compatibility reports rather than claiming every mode is tested.

## Does it work with Codex?

AgentTX can launch an installed `codex` executable and identifies it for reporting. It does not require private Codex hooks or special high-autonomy flags. As with other named CLIs, real version-and-platform reports are being collected.

## What happens if my repository changes while the agent runs?

Before acceptance, AgentTX compares every transaction-touched path with its raw fingerprint from transaction start. Unrelated changes remain untouched. If an overlapping path changed, acceptance stops before applying any transaction file and reports the conflict; you can continue inspecting or roll the transaction back.

## Why clone instead of worktree?

The independent clone keeps transaction objects, refs, and staged content out of the original repository's object database. This makes rollback boundaries simpler and avoids leaving transaction-only objects behind. It is deliberately slower and uses more disk than a linked worktree; the benchmark and roadmap document that tradeoff.

## Is it Windows compatible?

The core transaction workflow and CI cover Windows, Linux, and macOS. Windows command shims are explicitly best effort and weaker than Unix executable shims. Compatibility reports should include the agent, OS, Node, Git, and AgentTX versions plus whether input, edits, exit, diff, and rollback behaved correctly.
