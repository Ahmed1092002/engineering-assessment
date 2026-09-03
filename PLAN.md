# Plan and Known Limitations

## Implemented

- Customer application reads now enforce ownership.
- Partner status events are handled transactionally.
- Duplicate partner events are rejected without duplicate history or notification jobs.
- Stale events are rejected without changing current state.
- Illegal lifecycle transitions are rejected.
- Database constraints enforce one accepted history row and one notification job per application/event pair.

## Verification

Passed locally with Node `22.18.0` and pnpm `9.15.4`:

```sh
pnpm check
```

## Next Steps

- Implement retryable notification jobs with backoff, max attempts, and dead-letter state.
- Add worker tests for retry, exhausted jobs, and idempotency keys.
- Add a raw partner event log for duplicate/stale/invalid deliveries.
- Add partner adapter authentication and request signing.
- Add API contract tests documenting duplicate, stale, invalid-transition, and unknown-application responses.
- Add observability around event ingestion outcomes and notification delivery.
