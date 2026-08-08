# Product metrics and privacy

GitHub stars and npm downloads indicate distribution. They do not prove that AgentTX protects a workflow developers care about.

The strongest future product-value signals are:

- transactions created;
- commit rate and rollback rate;
- repeat users and transactions per active developer;
- risky actions detected;
- successful conflict refusals.

The central hypothesis is measurable without spin: **developers actually roll back agent sessions**. A rollback is not a vanity event. It means a developer reviewed an agent's transaction and chose not to accept its repository changes.

## V0 policy

AgentTX V0 has no telemetry. It does not transmit code, paths, prompts, commands, diffs, credentials, agent usage, or transaction metadata. Local ledgers and reports exist for the local user, not for AgentTX analytics.

## Possible future opt-in design

Any metrics system must be proposed and reviewed before code is added. A privacy-preserving design could default off, obtain explicit consent, document retention, and send only coarse events such as `transaction_created`, `transaction_committed`, `transaction_rolled_back`, `transaction_failed`, and `external_write_detected`.

It must not include repository identity, file paths, command text, prompts, code, diffs, credentials, or stable cross-machine identity. Public launch metrics must never be fabricated, and opt-in aggregate data must never be presented as all-user behavior.
