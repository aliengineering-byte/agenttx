# 13.8-second AgentTX demo

## Capture

Use the built CLI and the deterministic offline demo:

```powershell
npm ci
npm run build
./launch/RECORD_DEMO.ps1
```

Do not configure a remote and do not substitute a mocked transaction. The recording script runs `agenttx demo`, verifies the real output, and then renders a privacy-safe presentation of that evidence. The fake agent changes real files only inside a generated temporary Git repository; its `git push origin main` attempt is intercepted safely.

## Edit beats

| Time | Screen | Optional narration |
|---:|---|---|
| 0–1.2s | `agenttx demo`; isolated transaction starts | “Run the agent in a transaction.” |
| 1.2–3.8s | Six real file and side-effect actions | “It changes auth, dependencies, and CI.” |
| 3.8–6.2s | Red `BLOCKED`: simulated `git push` | “AgentTX gates the push.” |
| 6.2–8.6s | `agenttx inspect`; `Risk HIGH` and reasons | “Inspect the whole transaction.” |
| 8.6–10.6s | `agenttx diff`; seven-file summary | “Review everything it changed.” |
| 10.6–13.8s | Green rollback and unchanged workspace | “Reject the session without touching the repo.” |

The generated GIF is 1200×760, six frames, and about 100 KB. It visually emphasizes **BLOCKED**, **HIGH**, **ROLLBACK**, and **Original workspace unchanged**, contains no transaction ID or machine-specific path, and requires no mouse movement or narration.

## End card

```text
AgentTX
Make AI agents undoable.
Run → Inspect → Commit / Rollback
```
