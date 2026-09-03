# Production Design

## Boundaries

Split the system into explicit boundaries:

- Partner adapter: authenticated ingress, request validation, idempotency, ordering, and translation from partner vocabulary to internal commands.
- Application service: owns lifecycle rules, current state, history, and transactional outbox writes.
- Notification service: consumes outbox records, sends provider requests, handles retries, and records delivery evidence.
- Customer API: reads only through authenticated session identity and never trusts caller-supplied ids as authorization proof.

## Idempotency and Ordering

Store partner events with a unique `(applicationId, sourceEventId)` key. A duplicate delivery should return a stable duplicate response without creating new history or jobs.

Current application state should advance only when `occurredAt` is newer than the latest accepted business event and the transition is legal from the current status. Stale events should be retained in an operational event log if needed for reconciliation, but not appended to customer-visible lifecycle history as accepted state changes.

For higher-volume production use, I would keep a raw inbound event table separate from accepted status history. The raw table gives operators complete evidence without weakening the business history.

## Transactions and Outbox

Accepted status changes should update:

- current application status;
- immutable status history; and
- notification outbox row.

Those writes belong in one database transaction. The worker should consume the outbox, not create business decisions.

## Notifications

Notification jobs should have states such as `PENDING`, `PROCESSING`, `DELIVERED`, `RETRYABLE_FAILED`, and `DEAD_LETTERED`, plus `attemptCount`, `nextAttemptAt`, `lastError`, and timestamps. Retries should use bounded exponential backoff with jitter. Exhausted jobs should remain inspectable and replayable by an operator.

Provider calls should carry a stable idempotency key, ideally derived from the accepted history id or `(applicationId, sourceEventId, notificationType)`. Workers should claim jobs with lease/lock semantics so multiple workers can run safely.

## Authorization and Sensitive Data

The customer API should use real authentication, not `x-customer-id`. Authorization checks should be made server-side against the authenticated principal. Inaccessible and missing applications should both return 404 to avoid existence disclosure.

PII should be minimized in logs and job payloads. Job payloads should store references plus non-sensitive render inputs where possible. Secrets should live in managed secret storage, not source control or logs.

## Auditability and Observability

Use structured logs with correlation ids for partner event id, application id, history id, and notification job id. Emit metrics for accepted, duplicate, stale, invalid-transition, and failed events. Add traces across API transaction and worker delivery.

History should be append-only for accepted business changes. Operational event logs can capture rejected or duplicate deliveries for support and reconciliation.

## Deployment, Migrations, and Rollback

Schema changes should be released with forward-compatible migrations:

1. add nullable/new columns and indexes;
2. deploy code that writes both old and new shapes if needed;
3. backfill and validate;
4. enforce constraints; and
5. remove old behavior after confidence.

Rollback should preserve accepted history and outbox rows. If a deploy introduces bad lifecycle logic, pause ingestion, replay from the raw event log into a fixed version, and reconcile current state from accepted history.

## Postponed Tradeoffs

I would postpone cross-partner ordering protocols, complex event correction workflows, customer notification preferences, and richer web UI until the core state machine, outbox, and authorization boundaries are proven under production load.
