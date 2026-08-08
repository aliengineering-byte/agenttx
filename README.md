# AgentTX

**Make AI agents undoable.**

> The transaction layer for AI coding agents.

```bash
npx agenttx run claude
```

Let the agent work. Inspect everything it changed. Commit the good. Roll back the bad.

AgentTX is not an AI agent. It is the local control layer around agents.

```text
╭──────────────────────────────────────────╮
│ AgentTX Transaction                      │
│ atx_20260808_153522_a81f                 │
╰──────────────────────────────────────────╯

Changes
  12 files
  +482 / -191

Side Effects
  🛑 git push can modify a remote repository [BLOCKED]

Risk
  HIGH (8)

Next
  agenttx diff
  agenttx inspect
  agenttx commit
  agenttx rollback
```

- ✓ independent Git workspace
- ✓ dirty-repository baselines
- ✓ readable and machine-readable inspection
- ✓ heuristic risky-side-effect gates
- ✓ append-only event ledger
- ✓ conflict-safe acceptance
- ✓ rollback without modifying the original workspace
- ✓ no telemetry, accounts, API keys, Docker, or cloud service

## Five-second demo

```bash
git clone https://github.com/agenttx/agenttx.git
cd agenttx
npm install
npm run build
npm run demo
```

The demo uses a deterministic fake coding agent. It changes four files, adds a dependency-like entry, attempts `git push`, and leaves a real transaction in `REVIEW`. It needs no model API or credentials.

```bash
agenttx diff <transaction-id> --full
agenttx inspect <transaction-id>
agenttx rollback <transaction-id>
```

## Install

AgentTX requires Node.js 20 or newer and Git.

```bash
npm install --global agenttx
# or
npx agenttx run codex
```

The npm package name was available when V0 was prepared. This repository is versioned as `0.1.0`; publishing is a separate release action.

## Use

Run any executable from inside a Git repository:

```bash
agenttx run claude
agenttx run codex
agenttx run gemini
agenttx run opencode
agenttx run npm test
agenttx run bash
```

AgentTX passes the parent terminal through to the child, including stdin, stdout, stderr, and terminal capabilities. The child runs from the equivalent directory inside the isolated transaction workspace.

After the process exits:

```bash
agenttx status [transaction-id]
agenttx diff [transaction-id]
agenttx diff [transaction-id] --full
agenttx inspect [transaction-id]
agenttx inspect [transaction-id] --json
agenttx verify [transaction-id]
agenttx verify [transaction-id] --run
agenttx report [transaction-id] --html
agenttx commit [transaction-id]
agenttx rollback [transaction-id]
agenttx history
agenttx replay <transaction-id>
agenttx doctor
```

`commit` means “accept these transaction files into the original working tree.” It does **not** create a Git commit or stage files.

`replay` prints recorded events. V0 does **not** claim deterministic re-execution.

### External actions

AgentTX inserts best-effort wrappers for common commands such as `git`, `gh`, `curl`, `npm`, `docker`, `terraform`, `kubectl`, and cloud CLIs. Recognized external writes are blocked by default.

```bash
agenttx run --allow-external -- gh pr create
```

`--allow-external` is explicit approval to let detected external actions run. It does not make those actions reversible.

Command matching and PATH wrappers are **not a security sandbox**. A process can bypass them with an absolute binary path, an in-process network client, a renamed tool, or another execution route. See [the security model](docs/SECURITY_MODEL.md).

## How the transaction works

```text
original repository
       │
       ├── capture HEAD, status, and raw file fingerprints
       │
       ▼
independent local clone (--no-hardlinks)
       │
       ├── overlay tracked, staged, unstaged, and untracked baseline changes
       ├── create a private baseline commit
       └── run the child with terminal pass-through and heuristic command shims
       │
       ▼
REVIEW
       ├── diff / inspect / verify / report
       ├── commit: compare every touched path, then copy exact accepted files
       └── rollback: delete only the isolated clone
```

AgentTX uses an independent clone instead of a linked `git worktree`. Linked worktrees share Git’s object database; staging an agent-created credential could otherwise leave a dangling object in the original repository after rollback. `--no-hardlinks` keeps transaction objects and refs local to the transaction directory.

The original remote’s fetch URL is copied when present. Its push URL is replaced with `agenttx://blocked` unless the transaction was created with `--allow-external`. This is defense in depth, not containment.

### Dirty repositories

At transaction start, AgentTX overlays tracked changes and non-ignored untracked files into the clone, then commits that exact transaction baseline privately. Staged/unstaged distinctions are not reproduced inside the clone, but the original index is never changed.

At acceptance, each transaction-touched path must still match its raw start-time fingerprint. If the user changed an overlapping path while the agent ran, AgentTX stops before applying anything. Unrelated changes are preserved. A temporary recovery backup supports all-or-nothing restoration if file application fails.

### Local data

Transaction data lives at:

```text
~/.agenttx/transactions/<transaction-id>/
  metadata.json
  events.jsonl
  before.json
  after.json
  diff.patch
  risk.json
  verification.json
  report.html
  workspace/       # present until commit or rollback
```

Set `AGENTTX_HOME` to override the store location. No data is transmitted. There is no telemetry.

`diff.patch` is a redacted review artifact. Acceptance copies verified final file content from the isolated workspace; it does not apply the redacted patch.

## Risk model

Risk scoring is deterministic and transparent. V0 does not call an LLM.

| Condition | Points |
|---|---:|
| More than 20 changed files | +1 |
| Dependency manifest changed | +2 |
| Dependency lockfile changed | +2 |
| Potential credential path touched | +3 |
| External or remote side effect detected | +3 |
| Destructive command detected | +4 |
| Publish or deployment detected | +5 |

Scores map to `LOW` (0–2), `MEDIUM` (3–5), `HIGH` (6–8), and `CRITICAL` (9+).

## Verification policy

`agenttx verify` only detects common checks from conventional project files. It does not execute them automatically. `agenttx verify --run` is explicit approval to run project-defined commands inside the transaction workspace.

Detected families include Node (`test`, `typecheck`, `lint` scripts), Python (`pytest`), Rust (`cargo test`, `cargo clippy`), and Go (`go test ./...`). Project test commands execute repository code and should be treated accordingly.

## Architecture

```text
src/
  cli/          command surfaces and diagnostics
  core/         transaction, clone, state, ledger, commit, rollback
  adapters/     generic and named agent adapters
  detectors/    command-side effects and secret-bearing paths
  reporters/    terminal and standalone HTML
```

The core exports transaction primitives independently of the CLI. The current `AgentAdapter` boundary supports generic execution plus Claude, Codex, Gemini, and OpenCode identification without relying on undocumented hooks. A future `TransactionAdapter` layer can add database, browser, cloud, or MCP transactions only when those adapters have real commit/compensation behavior.

Structured JSON schemas are documented in [docs/SCHEMAS.md](docs/SCHEMAS.md). The design thesis is in [docs/WHY_TRANSACTIONS.md](docs/WHY_TRANSACTIONS.md).

## Honest limitations

- V0 requires a non-bare Git repository with at least one commit.
- Git submodules and repositories in active merge/cherry-pick/revert/bisect operations are rejected.
- Ignored files are not copied into the transaction workspace. That commonly includes `node_modules`, build caches, and `.env`; tools may need to recreate dependencies inside the transaction.
- The child retains the invoking user’s OS permissions. It can address paths outside the isolated repository.
- Side-effect observation sees the top-level command and commands reached through known PATH shims. It cannot see all subprocesses, in-process HTTP, browser actions, MCP calls, or renamed/absolute executables.
- Windows `.cmd` shims are best-effort and weaker than Unix executable shims.
- Secret redaction recognizes common patterns and paths; it cannot identify every credential format. Transaction source files may contain secrets because they are the files under review, but metadata, ledger events, terminal summaries, stored patches, and HTML reports are redacted.
- Rollback applies only before acceptance. V0 does not reverse a completed `agenttx commit`.
- Crash recovery preserves and finalizes a dead `RUNNING` transaction for review. Resume is not implemented.
- Independent clones add disk and setup overhead proportional to repository size.

## Roadmap

### V0

- [x] independent Git transaction workspace
- [x] CLI wrapper with interactive stdio
- [x] dirty baseline capture
- [x] diff and inspection
- [x] conflict-safe acceptance
- [x] rollback
- [x] transaction history and crash discovery
- [x] deterministic risk detection
- [x] secret redaction
- [x] JSON and standalone HTML reports

### Next

- [ ] OS-level sandboxing
- [ ] network transaction proxy
- [ ] stronger approval broker
- [ ] Claude hooks
- [ ] Codex integration
- [ ] MCP integration
- [ ] database transaction adapters
- [ ] deployment adapters
- [ ] team policies

### Future

AgentTX Cloud may add central policies, approvals, audit retention, agent identity, organization trust signals, and compliance controls. The open-source local transaction, diff, rollback, history, policy, and report workflow should remain genuinely useful.

ResiliReplay is a separate project: ResiliReplay breaks agents; AgentTX contains consequences. V0 has no coupling to it.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run build
npm pack --dry-run
```

The integration suite uses real temporary Git repositories and real child processes. It covers clean and dirty baselines, staged changes, untracked files, add/modify/delete/rename/binary changes, rollback, conflict-safe acceptance, crash recovery, side-effect gates, ledger corruption, CLI exit codes, JSON schemas, and secret non-disclosure.

Read [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) before changing safety-sensitive code.

## License

MIT
