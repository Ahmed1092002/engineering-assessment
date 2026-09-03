import { randomUUID } from "node:crypto";
import { prisma } from "@assessment/database";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";

async function resetApplication() {
  await prisma.notificationJob.deleteMany();
  await prisma.applicationStatusHistory.deleteMany();
  await prisma.loanApplication.deleteMany();
  await prisma.customer.deleteMany();

  await prisma.customer.create({
    data: {
      id: "customer-a",
      name: "Test Customer",
      email: "customer@example.test",
      phone: "+201111111111",
      applications: {
        create: {
          id: "application-a",
          status: "SUBMITTED",
          requestedAmountCents: 100_000_00,
          lastEventOccurredAt: new Date("2026-08-20T08:00:00.000Z"),
          history: {
            create: {
              id: randomUUID(),
              status: "SUBMITTED",
              sourceEventId: "initial-event",
              occurredAt: new Date("2026-08-20T08:00:00.000Z"),
            },
          },
        },
      },
    },
  });

  await prisma.customer.create({
    data: {
      id: "customer-b",
      name: "Other Customer",
      email: "other@example.test",
      phone: "+201222222222",
    },
  });
}

describe("application API", () => {
  beforeEach(resetApplication);

  it("returns an application with its history", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/applications/application-a",
      headers: { "x-customer-id": "customer-a" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: "application-a",
      status: "SUBMITTED",
      customer: { id: "customer-a" },
      history: [{ status: "SUBMITTED" }],
    });
    await app.close();
  });

  it("does not disclose another customer's application", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({
      method: "GET",
      url: "/v1/applications/application-a",
      headers: { "x-customer-id": "customer-b" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "application not found" });
    await app.close();
  });

  it("records a valid partner event and queues a notification", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications/application-a/status-events",
      payload: {
        eventId: "partner-event-1",
        status: "IN_REVIEW",
        occurredAt: "2026-08-20T09:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().application.status).toBe("IN_REVIEW");
    await expect(
      prisma.applicationStatusHistory.count({
        where: { sourceEventId: "partner-event-1" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.notificationJob.count({
        where: { sourceEventId: "partner-event-1" },
      }),
    ).resolves.toBe(1);
    await app.close();
  });

  it("rejects a retried partner event without duplicating history or jobs", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const payload = {
      eventId: "partner-event-duplicate",
      status: "IN_REVIEW",
      occurredAt: "2026-08-20T09:00:00.000Z",
    };

    const firstResponse = await app.inject({
      method: "POST",
      url: "/v1/applications/application-a/status-events",
      payload,
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/v1/applications/application-a/status-events",
      payload,
    });

    expect(firstResponse.statusCode).toBe(202);
    expect(secondResponse.statusCode).toBe(409);
    expect(secondResponse.json()).toEqual({ error: "duplicate status event" });
    await expect(
      prisma.applicationStatusHistory.count({
        where: { sourceEventId: payload.eventId },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.notificationJob.count({
        where: { sourceEventId: payload.eventId },
      }),
    ).resolves.toBe(1);
    await app.close();
  });

  it("rejects stale events without changing current state", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications/application-a/status-events",
      payload: {
        eventId: "partner-event-stale",
        status: "IN_REVIEW",
        occurredAt: "2026-08-20T07:59:59.000Z",
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ error: "stale status event" });
    await expect(
      prisma.loanApplication.findUniqueOrThrow({
        where: { id: "application-a" },
      }),
    ).resolves.toMatchObject({ status: "SUBMITTED" });
    await expect(
      prisma.applicationStatusHistory.count({
        where: { sourceEventId: "partner-event-stale" },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.notificationJob.count({
        where: { sourceEventId: "partner-event-stale" },
      }),
    ).resolves.toBe(0);
    await app.close();
  });

  it("rejects invalid status transitions without side effects", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications/application-a/status-events",
      payload: {
        eventId: "partner-event-invalid-transition",
        status: "DISBURSED",
        occurredAt: "2026-08-20T09:00:00.000Z",
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: "invalid status transition" });
    await expect(
      prisma.applicationStatusHistory.count({
        where: { sourceEventId: "partner-event-invalid-transition" },
      }),
    ).resolves.toBe(0);
    await expect(
      prisma.notificationJob.count({
        where: { sourceEventId: "partner-event-invalid-transition" },
      }),
    ).resolves.toBe(0);
    await app.close();
  });

  it("rejects malformed partner events", async () => {
    const app = buildApp({ database: prisma, logger: false });
    const response = await app.inject({
      method: "POST",
      url: "/v1/applications/application-a/status-events",
      payload: { eventId: "", status: "UNKNOWN", occurredAt: "yesterday" },
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
