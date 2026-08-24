import type { AuditAction, Role } from '@govflow/contracts';
import { prisma } from './db.js';
import { createLogger } from './logger.js';

const log = createLogger('audit');

export interface AuditInput {
  action: AuditAction | string;
  resourceType: string;
  resourceId: string;
  userId?: string | null;
  actorRole?: Role | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Appends an audit entry. Never throws: a failed audit write must not roll back
 * the operation being audited, but it is always logged.
 *
 * Document contents, credentials and raw department payloads are deliberately
 * never passed in here - only identifiers, statuses and counts.
 */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        userId: input.userId ?? null,
        actorRole: (input.actorRole ?? null) as never,
        metadata: (input.metadata ?? undefined) as never,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch (error) {
    log.warn('failed to persist audit entry', {
      action: input.action,
      resourceId: input.resourceId,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
