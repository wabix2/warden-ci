# Webhook state machine

`received -> processing -> processed`

Failure path: `processing -> failed`, with the delivery retained for safe retry according to the deployment queue/retry policy.

## Invariants

- Signature verification occurs before identity/processing.
- Delivery ID is the idempotency key.
- Empty or missing delivery identity is rejected.
- Duplicate or stale delivery claims do not execute side effects again.
- A successful side effect is followed by a durable `processed` state.
- Failed work is recorded with an error and is observable/retryable.
- Out-of-order events must be rejected or handled by a provider-specific monotonic state transition; they must never blindly overwrite newer state.

## Current implementation status

`src/github/webhookLifecycle.ts` provides the deterministic claim/process/mark contract and local state-machine tests. The active GitHub route currently acknowledges pull-request events before the historical executor and therefore does not yet provide a deployed durable event processor. Production webhook lifecycle verification is `BLOCKED` until the route is wired to a durable store/queue in controlled staging.
