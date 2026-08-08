# Credential-free fake agent

This deterministic child process behaves like a small coding agent without a model or API key.

Copy `agent.mjs` into a disposable Git repository, commit the baseline, then run:

```bash
agenttx run -- node agent.mjs
agenttx inspect
agenttx diff --full
agenttx rollback
```

The script changes one source file and adds one test file. AgentTX runs it from the isolated clone, so the original remains unchanged until acceptance.
