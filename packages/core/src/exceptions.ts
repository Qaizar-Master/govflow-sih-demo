import {
  AuditAction,
  ExceptionStatus,
  type ExceptionType,
  NotificationType,
  Role,
  Severity,
} from '@govflow/contracts';
import { prisma } from './db.js';
import { recordAudit } from './audit.js';
import { notifyRole } from './notifications.js';
import { createLogger } from './logger.js';

const log = createLogger('exceptions');

export interface RaiseExceptionInput {
  type: ExceptionType;
  severity?: Severity;
  message: string;
  applicationId?: string | null;
  workflowStepId?: string | null;
  retryCount?: number;
  details?: Record<string, unknown>;
  /** Notify officers so the item lands in their queue. Default true. */
  notify?: boolean;
}

/**
 * Materialises an exception. Every exhausted retry, unresolved mismatch and
 * missing document ends up here - this table IS the officer's work queue.
 */
export async function raiseException(input: RaiseExceptionInput) {
  const exception = await prisma.exception.create({
    data: {
      type: input.type as never,
      severity: (input.severity ?? Severity.MEDIUM) as never,
      message: input.message,
      applicationId: input.applicationId ?? null,
      workflowStepId: input.workflowStepId ?? null,
      retryCount: input.retryCount ?? 0,
      details: (input.details ?? undefined) as never,
      status: ExceptionStatus.OPEN as never,
    },
  });

  await recordAudit({
    action: AuditAction.EXCEPTION_CREATED,
    resourceType: 'Exception',
    resourceId: exception.id,
    metadata: {
      type: input.type,
      severity: exception.severity,
      applicationId: input.applicationId ?? null,
      retryCount: exception.retryCount,
    },
  });

  if (input.notify !== false) {
    const application = input.applicationId
      ? await prisma.application.findUnique({
          where: { id: input.applicationId },
          select: { applicationNumber: true },
        })
      : null;
    await notifyRole(
      [Role.OFFICER, Role.ADMIN],
      `Exception on ${application?.applicationNumber ?? 'the platform'}`,
      input.message,
      input.applicationId ?? null,
      exception.severity === Severity.CRITICAL || exception.severity === Severity.HIGH
        ? NotificationType.ERROR
        : NotificationType.WARNING,
    );
  }

  log.warn('exception raised', {
    id: exception.id,
    type: input.type,
    applicationId: input.applicationId,
  });
  return exception;
}

export async function resolveException(
  exceptionId: string,
  resolvedById: string,
  notes: string,
  status: ExceptionStatus = ExceptionStatus.RESOLVED,
) {
  const exception = await prisma.exception.update({
    where: { id: exceptionId },
    data: {
      status: status as never,
      resolvedAt: new Date(),
      resolvedById,
      resolutionNotes: notes,
    },
  });
  await recordAudit({
    action: AuditAction.EXCEPTION_RESOLVED,
    resourceType: 'Exception',
    resourceId: exceptionId,
    userId: resolvedById,
    metadata: { status, applicationId: exception.applicationId },
  });
  return exception;
}
