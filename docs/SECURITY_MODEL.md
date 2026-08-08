# AgentTX V0 security model

AgentTX V0 provides **reversible workspace transactions with heuristic side-effect detection and approval gates**.

It is not an OS sandbox. It does not make arbitrary processes safe, and it does not make external actions reversible.

## What V0 protects against

### Accidental workspace modification

The child runs in an independent local Git clone under the AgentTX transaction store. Tracked, staged, unstaged, and non-ignored untracked starting content is overlaid into that clone. The original working tree and index are not used as the child's current directory.

The clone uses `--no-hardlinks`; transaction objects and refs do not share the original repository's object database.

### Accidental loss through rollback

Before acceptance, rollback removes only the isolated clone. The implementation validates that the deletion target is contained by the transaction directory. It does not run reset, clean, checkout, or restore against the original repository.

### Overwriting concurrent user work

AgentTX captures raw SHA-256 fingerprints, type, size, and mode for the repository baseline. Acceptance checks every touched source and destination path against that baseline before applying any change. An overlap stops the operation before application. Unrelated paths are not written.

Application uses a private temporary backup. If an application step fails, AgentTX restores every touched path before returning an error.

### Some recognizable external writes

V0 classifies the top-level command and installs PATH shims for selected tools. Recognized external actions are blocked unless the transaction starts with `--allow-external`. The cloned repository's push URL is also made invalid by default.

This is defense in depth against accidents, not a containment guarantee.

### Common secret patterns in product artifacts

Metadata, ledger data, command evidence, stored unified patches, terminal reports, HTML reports, and error text pass through redaction for common token, password, private-key, URL-credential, and environment-assignment patterns. Sensitive object keys are replaced recursively. Secret-bearing paths are reported without values.

The event ledger is append-only JSONL with monotonic sequence numbers and a SHA-256 hash chain. An incomplete final line is recoverable; completed-line mutation and chain corruption are detected.

## What V0 does not protect against

- A malicious process using the invoking user's OS permissions.
- Reads or writes outside the transaction workspace.
- Kernel attacks, privilege escalation, namespace escape, or compromised operating systems.
- All network access or exfiltration.
- In-process HTTP clients, browser actions, MCP calls, direct APIs, renamed tools, and absolute executable paths that bypass PATH shims.
- A process changing Git configuration or supplying an explicit push URL.
- Unknown external APIs or novel CLI syntax.
- Compromised dependencies, compilers, Git filters, credential helpers, shell startup files, or global tooling.
- All destructive commands.
- Secret formats that do not match current detectors.
- Secrets present in the transaction's source files or private Git object database. Those files are the content under review and remain local until commit or rollback.
- Actions completed after explicit `--allow-external` approval.
- Reversal of `agenttx commit`. Acceptance is a terminal transaction state in V0.

## Trust boundaries

The original repository is protected only from ordinary workspace edits made from the transaction current directory. The child still runs as the user and can name the original path directly; the path is exposed in `AGENTTX_ORIGINAL_WORKSPACE` for tool awareness. This environment variable is not an access control mechanism.

AgentTX's local store is trusted. Any process with the same user's permissions may alter metadata, the isolated workspace, or ledger files. The ledger hash chain detects accidental corruption and unsophisticated mutation; it has no keyed signature and is not tamper-proof against a process that can rewrite the entire ledger.

Git itself, Node.js, the operating system, global Git configuration, clean/smudge filters, and invoked project commands are outside the V0 trust boundary.

## External approval semantics

Without `--allow-external`, a recognized external write returns exit code 77 and is recorded as blocked. With the flag, the finding is recorded as allowed and the command executes normally.

Approval is transaction-wide and coarse in V0. It is not a per-command interactive broker. A future release should use a separate policy-enforcement process and network mediation.

## Secret handling

AgentTX never intentionally transmits code, prompts, commands, diffs, paths, ledger data, or secrets. Telemetry is absent.

Redaction is applied before structured event persistence. Stored patches are redacted. Reports use structured summaries rather than raw secret file content.

The isolated workspace must retain the actual file content for review and acceptance. Users should roll back unwanted secret-bearing transactions promptly and protect `~/.agenttx` with normal user-directory permissions.

## Crash behavior

Atomic replacement is used for structured JSON metadata. On a later invocation, a `RUNNING` transaction whose parent PID no longer exists is finalized into `REVIEW` when possible and marked interrupted. If finalization fails, it enters `FAILED`. Both states can be rolled back. Resume is deliberately unsupported.

## Future security work

- OS-specific filesystem and process isolation.
- Network proxying with destination/method policy.
- Capability-scoped credentials and short-lived agent identity.
- Out-of-process approval broker.
- Signed append-only audit streams.
- Sandboxed Git filters and project verification.
- Windows-native command interception.
- Secret scanning with entropy and provider-specific validation without value retention.
