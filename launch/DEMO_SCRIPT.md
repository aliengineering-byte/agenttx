# 15-second AgentTX demo script

## Capture

Use the built CLI and the deterministic offline demo:

```bash
npm ci
npm run build
npm run demo
```

Do not configure a remote and do not substitute a mocked terminal. The fake agent changes real files only inside a generated temporary Git repository; its `git push origin main` attempt is intercepted safely.

## Edit beats

| Time | Screen | Optional narration |
|---:|---|---|
| 0–3s | `agenttx demo`; six short agent actions | “The agent changes auth, dependencies, and CI.” |
| 3–6s | Red `BLOCKED`: `git push origin main` | “AgentTX gates the push.” |
| 6–10s | `7 files`, `Risk HIGH`, reasons | “Inspect the whole transaction.” |
| 10–15s | Green `ROLLBACK` and `Original workspace unchanged` | “Reject the session without touching the repo.” |

Visually emphasize **BLOCKED**, **INSPECT**, **ROLLBACK**, and **UNCHANGED**. Crop machine-specific temporary paths if a recorder displays them. Review every final frame for private data.

## End card

```text
AgentTX
Make AI agents undoable.
Run → Inspect → Commit / Rollback
```
