# Security policy

AgentTX is safety-sensitive infrastructure. Please report suspected vulnerabilities privately rather than opening a public issue.

Until a dedicated security inbox is published with the repository, use GitHub's private vulnerability reporting feature under **Security → Report a vulnerability**.

Include:

- affected AgentTX version and platform;
- reproduction steps using a disposable repository;
- the safety property that failed;
- whether original data, credentials, or external systems were affected;
- suggested mitigations, if known.

Do not include live credentials, private source code, or destructive reproduction commands.

## Supported versions

Before the first stable release, only the latest `0.x` release receives security fixes.

## Scope

High-priority reports include:

- rollback changing or deleting original workspace content;
- acceptance overwriting a concurrent user edit;
- a secret value appearing in metadata, ledger events, stored patches, reports, or errors despite matching a documented detector;
- command gates reporting an action as blocked when it executed through the gated path;
- path traversal from repository paths into transaction-store or original-workspace writes;
- package contents differing materially from the reviewed source.

The documented fact that V0 is not an OS sandbox is not itself a vulnerability. Bypasses that contradict a specific documented guarantee are in scope. Read [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) first.
