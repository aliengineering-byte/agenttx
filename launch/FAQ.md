# AgentTX FAQ

## Why not just use Git?

Git provides the state substrate, and experienced users can manually build parts of this workflow with branches, clones, stashes, and worktrees. AgentTX packages dirty-baseline capture, agent execution, event history, side-effect findings, deterministic risk, verification discovery, reports, conflict-safe acceptance, and rollback into one transaction lifecycle. It also keeps the original index untouched. If a manual Git workflow already meets your needs, use it.

## Is AgentTX a sandbox?

It is a repository transaction boundary, not an OS security sandbox. The child runs in an isolated clone but retains the invoking user's normal permissions. It can address files and systems outside the repository.

## Does it work with Claude Code?

AgentTX can generically launch an installed `claude` command and identifies it as Claude. V0 does not rely on private Claude hooks. Compatibility depends on the installed version and platform; check the published compatibility record rather than assuming every interactive mode was smoke-tested.

## Does it work with Codex?

AgentTX can generically launch an installed `codex` command and identifies it as Codex. V0 does not rely on private Codex hooks. Compatibility depends on the installed version and platform; no special high-autonomy flags are required by AgentTX.

## Does it require API keys?

AgentTX itself does not. A coding agent may require its own authentication. The built-in demo uses a deterministic fake agent and needs no credentials, model, Docker daemon, or network.

## Does it upload my code?

No. V0 has no telemetry or service backend and does not upload code, paths, prompts, commands, diffs, credentials, or transaction metadata. A child agent can still use its own network capabilities according to that tool's behavior and your environment.

## Can it roll back git push?

No. Remote side effects are not inherently reversible. AgentTX may detect and gate selected commands heuristically, but V0's strong rollback guarantee applies to isolated repository transaction state, not arbitrary external systems. Never use `--allow-external` as if it made an action reversible.

## Can it stop malicious processes?

No. AgentTX is not a malware boundary. Absolute binaries, renamed tools, libraries, in-process network clients, or direct access outside the repository can bypass command shims. Use OS/process isolation appropriate to the trust level of the code.

## Does it work with dirty repositories?

Yes, with important details. AgentTX overlays tracked changes and non-ignored untracked files into the transaction baseline. The original index and working tree remain in place. On acceptance, unrelated concurrent changes are preserved and overlapping changes cause a refusal before transaction files are applied. Ignored files are not copied.

## Does it work on Windows?

The core repository workflow and tests support Windows, Linux, and macOS. Windows command shims are explicitly best effort and weaker than Unix executable shims. Report exact agent, OS, Node, Git, and AgentTX versions for compatibility issues.

## Why clone instead of worktree?

Linked worktrees share Git's object database. An agent that stages secret-bearing content could leave an object in the original repository even after its worktree is removed. AgentTX uses an independent `--no-hardlinks` clone so transaction objects and refs stay in the transaction directory. The tradeoff is setup time and disk proportional to repository size.

## What happens if my original repository changes during a transaction?

Unrelated changes are preserved. Before acceptance, AgentTX compares every transaction-touched path with its raw start-time fingerprint. If an overlapping path changed, acceptance stops before applying any transaction file, tells you the affected paths, and leaves your existing work in place. You can inspect or roll back the transaction.
