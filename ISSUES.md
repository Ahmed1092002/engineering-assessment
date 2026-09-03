# Issues and Chosen Scope

## Prioritized Risks

1. Partner event ingestion was not idempotent. Retrying the same `eventId` created duplicate customer-visible history and duplicate notification jobs.
2. Late or out-of-order partner events could overwrite the current application state, so the record could describe the last HTTP request rather than the newest business event.
3. Invalid lifecycle jumps were accepted, including direct transitions from `SUBMITTED` to terminal states that are not legal in the domain model.
4. Application reads checked for a customer header but did not enforce ownership, allowing one caller-controlled customer id to read another customer's application.
5. Status updates, history writes, and notification job creation were separate writes, so partial failure could leave the system inconsistent.
6. Notification failures are marked processed immediately. Temporary provider failures are therefore not retried and are not cleanly inspectable as exhausted work.
7. Partner adapter authentication is missing. That is acceptable for the exercise only if the production trust boundary is explicit.

## Scope Chosen

I addressed the status-event correctness and read-authorization slice:

- enforce application ownership on `GET /v1/applications/:applicationId`;
- reject duplicate `eventId` deliveries per application;
- reject stale events whose `occurredAt` is not newer than the current application state;
- reject illegal lifecycle transitions;
- wrap accepted status, immutable history, and notification job creation in one transaction;
- add database uniqueness constraints for event-derived history and notification jobs; and
- add focused API tests for those behaviors.

I chose this slice because it protects the primary business record and the customer-visible audit trail. Notification retry behavior is important, but retrying bad or duplicated jobs is less useful if the upstream state transition is already untrustworthy.

## Deliberately Left Alone

- Notification retries, backoff, dead-letter handling, and multi-worker locking are described in `DESIGN.md` rather than implemented.
- Partner authentication is left as a production design concern because the local exercise explicitly treats the endpoint as an internal adapter.
- The web UI remains intentionally simple; the main risk was server-side data isolation, not presentation.
