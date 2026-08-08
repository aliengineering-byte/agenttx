# Agent compatibility

AgentTX's stable interface is command wrapping, not a private integration:

```bash
agenttx run [--] <command...>
```

The child receives an interactive terminal and runs from the equivalent directory in the isolated transaction workspace. Its exit code is returned, then AgentTX enters `REVIEW` so the result can be diffed, inspected, verified, accepted, or rolled back.

## Compatibility levels

| Level | Meaning |
|---|---|
| Generic command verified | Real child processes modify the transaction workspace, leave the original unchanged, return their exit status, and support diff/commit/rollback. Covered on every test run. |
| Named identification | AgentTX recognizes the executable names `claude`, `codex`, `gemini`, and `opencode` for reporting. The V0 adapter does not rely on vendor-specific hooks. |
| Agent smoke-tested | A named CLI version was launched interactively and completed a harmless file-edit transaction on the stated OS. This must be recorded with version and date. |

The v0.1.0 release environment verified generic child-process behavior. It did not complete a paid or interactive smoke test with Claude Code, Codex, Gemini CLI, or OpenCode, so no agent-specific version is claimed here.

## Reporting compatibility

Please use the Agent compatibility issue template and include:

- agent name and version;
- operating system;
- Node, Git, and AgentTX versions;
- the command used;
- whether interactive input, edits, exit, diff, and rollback behaved as expected.

Remove secrets, prompts, private paths, and code before submitting logs.
