# Proof Mode

AgentTX Proof Mode wraps one argv-based command in an isolated repository transaction, runs explicit gates, derives the verdict, and writes a portable proof pack.

```bash
agenttx proof --validator '["npm","test"]' -- codex exec "fix issue 123"
```

The three generated files are `proof.json`, the self-contained and JavaScript-free `proof.html`, and `reproduce.md`. Verify the complete bundle without a network connection:

```bash
agenttx verify-proof path/to/proof.json
```

## Configuration

For commands whose argument boundaries should not depend on shell quoting, use `.agenttx/proof.json`:

```json
{
  "validators": [
    {
      "id": "tests",
      "argv": ["npm", "test"],
      "required": true,
      "shell": true,
      "timeoutMs": 120000
    }
  ],
  "relatedEvidence": []
}
```

`shell` defaults to `false`. Set it only for a validator that actually needs a platform shell. The wrapped command also runs without a shell unless `--shell` is explicit. Proof Mode preserves argv boundaries, caps execution time and captured output, refuses nested transactions, and never records the environment or prompts.

Useful options:

- `--optional-validator '["tool","arg"]'` records but does not gate an optional check.
- `--no-commit` leaves an accepted transaction in `REVIEW`.
- `--no-rollback` leaves rejected changes isolated for inspection.
- `--output-dir path` chooses a new, non-existing proof directory.
- `--privacy minimal` withholds changed paths and output previews.
- `--allow-external` explicitly accepts that the command may cause effects AgentTX cannot roll back; the receipt retains that limitation.
- `--dry-run --json` validates and prints the bounded execution plan without running the command.
- `--max-output-bytes`, `--max-evidence-bytes`, and `--timeout-ms` tighten resource bounds.

## Related evidence

Related evidence stays in its producer's schema. AgentTX records a typed reference, copies the verified artifact into the proof pack, and binds its bytes by SHA-256:

```json
{
  "relatedEvidence": [
    {
      "producer": "io.github.aliengineering-byte/resilireplay",
      "version": "0.8.0",
      "capability": "reliability-campaign",
      "path": "artifacts/resilireplay-evidence.json",
      "verify": ["resilireplay", "verify", "{evidence}"],
      "required": true
    }
  ]
}
```

Failure to find or verify required related evidence rejects the transaction and triggers the configured rollback behavior.

## Security boundary

AgentTX isolates Git-visible repository changes. It is not an operating-system sandbox. A child retains the invoking user's permissions. AgentTX cannot undo remote pushes, emails, API calls, database writes, or other external side effects. Receipt integrity is unsigned and recomputable; it detects partial or accidental tampering but does not authenticate a party able to rewrite the entire artifact.

Run the deterministic bad-agent/good-agent demonstration with no model account or paid API:

```bash
npm run build
npm run demo:proof
```
