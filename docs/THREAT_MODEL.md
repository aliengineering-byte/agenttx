# AgentTX threat model

## Scope

V0 is designed to reduce accidental damage from AI coding-agent workspace changes and to surface some likely external side effects. It assumes the user, operating system, Node.js runtime, Git binary, and local AgentTX store are trusted.

| Threat | Impact | Current mitigation | Remaining gap | Future mitigation |
|---|---|---|---|---|
| Confused agent edits the wrong repository files | Source loss or unwanted changes | Child current directory is an independent clone; rollback deletes only that clone | Agent can directly name paths outside the clone | OS filesystem namespace and capability policy |
| Malicious agent | Arbitrary user-level actions | Some command gates, invalid push URL by default, local audit events | Same OS permissions as user; gates are bypassable | Sandboxed worker, least-privilege identity, brokered capabilities |
| Malicious repository | Code execution through scripts, filters, or tooling | Verification is opt-in; no automatic arbitrary script execution | Clone/checkout can invoke configured filters; agent runs repository code | Filter-free checkout, isolated build runner, repository trust policy |
| Prompt injection | Agent sends data or performs external writes | Known external CLI writes are flagged or blocked | Injection can use in-process networking, browser, MCP, or unknown tools | Network/MCP/browser transaction adapters and policy engine |
| Poisoned dependency | Credential theft or code execution | Dependencies are not installed automatically by AgentTX | Agent or approved verification may install/run them | Dependency sandbox, provenance policy, egress controls |
| Compromised tool | False output, arbitrary filesystem/network actions | Event ledger records only what AgentTX observes | Tool can bypass shims and alter the local store | Separate privileged monitor, signed events, OS audit APIs |
| Malicious shell command | Destructive local or remote action | A narrow set of broad deletion patterns and external writes is blocked | Shell composition, aliases, absolute paths, and novel syntax bypass matching | AST-aware shell mediation plus OS sandbox |
| Credential exfiltration | Account or infrastructure compromise | Common values redacted; common paths flagged; no telemetry | Reads are mostly unobservable; network egress is open | File access auditing, secret broker, network proxy |
| Network side effect | Remote state mutation | Selected CLI write patterns blocked by default | Direct sockets/HTTP libraries and unknown commands remain | Transaction proxy with allow/approve/record policy |
| Destructive filesystem operation | Data loss outside repository | Transaction edits are isolated; very broad deletion patterns blocked | User-level process can delete any accessible path | Filesystem namespaces, read-only mounts, mediated write capabilities |
| Concurrent user modification | Agent acceptance overwrites user work | Raw baseline fingerprints for all touched paths; stop-before-apply conflict check | Files may change after check during application | OS file locks or filesystem transaction primitive |
| AgentTX crash during child execution | Stranded clone or ambiguous state | Dead `RUNNING` transaction becomes interrupted `REVIEW` or `FAILED` | No safe child resume | Supervisor process and durable process identity |
| Crash during acceptance | Partial working-tree application | Pre-application conflict check and private recovery backup; failures trigger restoration | Power loss between writes can require manual backup recovery | Journaled commit intent and atomic filesystem snapshot |
| Ledger tampering | Misleading audit | Sequence and SHA-256 hash chain detect line mutation | Same-user attacker can recompute the whole chain | Keyed signatures and remote/WORM audit sink |
| Secret written into transaction | Secret appears in product artifacts | Structured artifacts and patch are redacted; reports omit raw diffs | Actual isolated source and Git objects retain content for review | Encrypted transaction store and secret-aware object handling |
| Push to original local repository | Original refs change | Independent clone rewrites or removes local-clone origin; push URL invalid unless approved | Agent can explicitly address the original path | Hide original mount and broker Git remote access |

## Abuse cases deliberately not claimed as solved

AgentTX V0 is not a malware sandbox, endpoint protection product, data-loss-prevention system, or network firewall. Running untrusted code remains dangerous. The safety promise is narrower: ordinary repository changes are transacted, concurrent overlaps are rejected, product artifacts redact common secrets, and selected external writes receive heuristic gates.
