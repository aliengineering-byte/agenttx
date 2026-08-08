# Show HN draft

## Title

Show HN: AgentTX – Git-style transactions for AI coding agents

## Post

Coding agents are getting enough autonomy to change source, dependencies, CI, and Git state across a repository. I wanted a better boundary than letting each experimental session write directly into my working tree.

AgentTX wraps an arbitrary command in a local repository transaction:

```text
agenttx run <agent>
agenttx diff / inspect / verify
agenttx commit  # accept files into the working tree
# or
agenttx rollback
```

The original repository stays available while the child runs in an independent no-hardlink clone. AgentTX overlays the dirty baseline, records a hash-chained event ledger, produces deterministic risk and redacted reports, and checks every touched path for concurrent user changes before acceptance. `commit` accepts files; it does not create a Git commit.

The demo is fully local and deterministic: a fake agent changes seven files, including dependencies and CI, deletes a source file, and safely attempts `git push` through AgentTX's shim. The push is gated, the transaction is rated HIGH, and rollback verifies the original repository is still clean.

Important limitation: this is repository transaction isolation, not an OS sandbox. The child keeps the invoking user's permissions. Command gating is heuristic and can be bypassed by absolute binaries, renamed tools, libraries, or in-process network calls. AgentTX cannot undo a real push or arbitrary external side effect.

V0 is TypeScript, MIT licensed, zero runtime dependencies, no telemetry, and requires Node 20+ plus Git. It supports arbitrary commands rather than depending on one agent vendor.

Repository: [INSERT VERIFIED PUBLIC URL]

I would especially value feedback on real agent/platform compatibility, large-repository setup cost, and where the transaction boundary is most useful in daily work.
