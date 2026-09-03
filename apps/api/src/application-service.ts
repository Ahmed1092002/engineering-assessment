import { randomUUID } from "node:crypto";
import type { ApplicationStatus, ApplicationView, StatusEventInput } from "@assessment/contracts";
import type { PrismaClient } from "@assessment/database";

export class ApplicationNotFoundError extends Error {
  constructor(applicationId: string) {
    super(`Application ${applicationId} was not found`);
    this.name = "ApplicationNotFoundError";
  }
}

export class DuplicateStatusEventError extends Error {
  constructor(eventId: string) {
    super(`Status event ${eventId} was already recorded`);
    this.name = "DuplicateStatusEventError";
  }
}

export class StaleStatusEventError extends Error {
  constructor(eventId: string) {
    super(`Status event ${eventId} is older than the current application state`);
    this.name = "StaleStatusEventError";
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Cannot transition application from ${from} to ${to}`);
    this.name = "InvalidStatusTransitionError";
  }
}

const allowedTransitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  SUBMITTED: ["IN_REVIEW"],
  IN_REVIEW: ["OFFERED", "DECLINED"],
  OFFERED: ["APPROVED", "DECLINED"],
  APPROVED: ["DISBURSED"],
  DECLINED: [],
  DISBURSED: [],
};

function assertLegalTransition(from: ApplicationStatus, to: ApplicationStatus) {
  if (from === to) return;
  if (!allowedTransitions[from].includes(to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}

export async function getApplication(
  database: PrismaClient,
  applicationId: string,
  customerId?: string,
): Promise<ApplicationView | null> {
  const application = await database.loanApplication.findFirst({
    where: { id: applicationId, ...(customerId ? { customerId } : {}) },
    include: {
      customer: true,
      history: { orderBy: { occurredAt: "desc" } },
    },
  });

  if (!application) return null;

  return {
    id: application.id,
    status: application.status as ApplicationStatus,
    requestedAmountCents: application.requestedAmountCents,
    currency: application.currency,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    customer: {
      id: application.customer.id,
      name: application.customer.name,
      email: application.customer.email,
      phone: application.customer.phone,
    },
    history: application.history.map((entry) => ({
      id: entry.id,
      status: entry.status as ApplicationStatus,
      reason: entry.reason,
      occurredAt: entry.occurredAt.toISOString(),
      recordedAt: entry.recordedAt.toISOString(),
    })),
  };
}

export async function recordStatusEvent(
  database: PrismaClient,
  applicationId: string,
  event: StatusEventInput,
): Promise<ApplicationView> {
  await database.$transaction(async (tx) => {
    const application = await tx.loanApplication.findUnique({
      where: { id: applicationId },
    });

    if (!application) throw new ApplicationNotFoundError(applicationId);

    const duplicate = await tx.applicationStatusHistory.findUnique({
      where: {
        applicationId_sourceEventId: {
          applicationId,
          sourceEventId: event.eventId,
        },
      },
    });

    if (duplicate) throw new DuplicateStatusEventError(event.eventId);

    const occurredAt = new Date(event.occurredAt);
    if (
      application.lastEventOccurredAt &&
      occurredAt <= application.lastEventOccurredAt
    ) {
      throw new StaleStatusEventError(event.eventId);
    }

    assertLegalTransition(
      application.status as ApplicationStatus,
      event.status,
    );

    await tx.loanApplication.update({
      where: { id: applicationId },
      data: {
        status: event.status,
        lastEventOccurredAt: occurredAt,
      },
    });

    await tx.applicationStatusHistory.create({
      data: {
        id: randomUUID(),
        applicationId,
        status: event.status,
        reason: event.reason,
        sourceEventId: event.eventId,
        occurredAt,
      },
    });

    await tx.notificationJob.create({
      data: {
        id: randomUUID(),
        applicationId,
        sourceEventId: event.eventId,
        type: "APPLICATION_STATUS_CHANGED",
        payload: JSON.stringify({
          status: event.status,
          reason: event.reason ?? null,
        }),
      },
    });
  });

  const updated = await getApplication(database, applicationId);
  if (!updated) throw new ApplicationNotFoundError(applicationId);
  return updated;
}
