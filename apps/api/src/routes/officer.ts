import { Router } from 'express';
import { z } from 'zod';
import { ApplicationStatus, ExceptionStatus, Severity } from '@govflow/contracts';
import {
  getApplicationDetail,
  listApplications,
  officerMetrics,
  prisma,
  recordOfficerDecision,
  resolveException,
  resumeWorkflow,
  timeSavedReport,
} from '@govflow/core';
import { ApiError } from '../lib/api-error.js';
import { handler } from '../lib/async-handler.js';
import { ok } from '../lib/respond.js';
import {
  assertOfficerScope,
  authenticate,
  officerServiceScope,
  requireOfficer,
} from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

export const officerRouter = Router();
officerRouter.use(authenticate, requireOfficer);

const queueQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

officerRouter.get(
  '/metrics',
  handler(async (req, res) =>
    ok(res, await officerMetrics((await officerServiceScope(req)) ?? undefined)),
  ),
);

/**
 * What GovFlow saved, split into what was measured and what was assumed.
 *
 * Deliberately a separate endpoint rather than extra fields on /metrics: the
 * assumptions and the caveat travel with the number, and a caller cannot pick
 * up the estimate without them.
 */
officerRouter.get(
  '/time-saved',
  handler(async (req, res) =>
    ok(res, await timeSavedReport((await officerServiceScope(req)) ?? undefined)),
  ),
);

officerRouter.get(
  '/applications',
  validateQuery(queueQuerySchema),
  handler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof queueQuerySchema>;
    const valid = new Set<string>(Object.values(ApplicationStatus));
    const statuses = query.status
      ? (query.status
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter((s) => valid.has(s)) as ApplicationStatus[])
      : undefined;

    // Two statuses an officer must never be handed:
    //  - DRAFT, which is a half-typed form the citizen has not sent. Showing it
    //    would put unsubmitted personal answers in front of a stranger.
    //  - AWAITING_CITIZEN_ACTION, where the file is missing evidence only the
    //    applicant can supply, so there is nothing yet to decide.
    const OFFICER_VISIBLE = Object.values(ApplicationStatus).filter(
      (s) => s !== ApplicationStatus.AWAITING_CITIZEN_ACTION && s !== ApplicationStatus.DRAFT,
    ) as ApplicationStatus[];

    // Scoped to the services this officer's department owns.
    const serviceTypes = await officerServiceScope(req);

    return ok(
      res,
      await listApplications({
        statuses: statuses?.length ? statuses : OFFICER_VISIBLE,
        ...(serviceTypes ? { serviceTypes } : {}),
        search: query.search,
        page: query.page,
        pageSize: query.pageSize,
      }),
    );
  }),
);

officerRouter.get(
  '/applications/:id',
  handler(async (req, res) => {
    await assertOfficerScope(req, req.params.id!);
    const detail = await getApplicationDetail(req.params.id!);
    if (!detail) throw ApiError.notFound('Application not found');
    return ok(res, detail);
  }),
);

const decisionSchema = z.object({
  notes: z.string().trim().min(5, 'A decision must be justified').max(2000),
});

officerRouter.post(
  '/applications/:id/approve',
  validateBody(decisionSchema),
  handler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    await assertOfficerScope(req, req.params.id!);
    try {
      const updated = await recordOfficerDecision({
        applicationId: req.params.id!,
        officerId: req.user!.id,
        decision: 'APPROVE',
        notes: body.notes,
      });
      return ok(res, {
        id: updated.id,
        applicationNumber: updated.applicationNumber,
        status: updated.status,
        decisionAt: updated.decisionAt?.toISOString() ?? null,
      });
    } catch (error) {
      throw toDecisionError(error);
    }
  }),
);

officerRouter.post(
  '/applications/:id/reject',
  validateBody(decisionSchema),
  handler(async (req, res) => {
    const body = req.body as z.infer<typeof decisionSchema>;
    await assertOfficerScope(req, req.params.id!);
    try {
      const updated = await recordOfficerDecision({
        applicationId: req.params.id!,
        officerId: req.user!.id,
        decision: 'REJECT',
        notes: body.notes,
      });
      return ok(res, {
        id: updated.id,
        applicationNumber: updated.applicationNumber,
        status: updated.status,
        decisionAt: updated.decisionAt?.toISOString() ?? null,
      });
    } catch (error) {
      throw toDecisionError(error);
    }
  }),
);

function toDecisionError(error: unknown): ApiError {
  const message = error instanceof Error ? error.message : 'Decision could not be recorded';
  if (message.includes('already been decided')) return ApiError.conflict(message);
  if (message.includes('not found')) return ApiError.notFound('Application not found');
  return ApiError.badRequest(message);
}

officerRouter.post(
  '/applications/:id/resume',
  handler(async (req, res) => {
    await assertOfficerScope(req, req.params.id!);
    const result = await resumeWorkflow(req.params.id!, { userId: req.user!.id });
    return ok(res, {
      resumedStep: result.resumedStep,
      message: result.resumedStep
        ? `Workflow re-queued at ${result.resumedStep}.`
        : 'Nothing to resume.',
    });
  }),
);

// ---------------------------------------------------------------------------
// Exception queue
// ---------------------------------------------------------------------------
const exceptionQuerySchema = z.object({
  status: z.string().optional(),
  severity: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

officerRouter.get(
  '/exceptions',
  validateQuery(exceptionQuerySchema),
  handler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof exceptionQuerySchema>;
    const validStatus = new Set<string>(Object.values(ExceptionStatus));
    const validSeverity = new Set<string>(Object.values(Severity));

    const statuses = (query.status ?? 'OPEN,ACKNOWLEDGED')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => validStatus.has(s));
    const severities = query.severity
      ?.split(',')
      .map((s) => s.trim().toUpperCase())
      .filter((s) => validSeverity.has(s));

    // Exceptions follow their application's scope. Platform-level exceptions
    // (no application attached) are an admin concern, so a scoped officer does
    // not see them at all rather than seeing them without context.
    const serviceTypes = await officerServiceScope(req);

    const where = {
      ...(statuses.length ? { status: { in: statuses as never } } : {}),
      ...(severities?.length ? { severity: { in: severities as never } } : {}),
      ...(serviceTypes ? { application: { serviceType: { in: serviceTypes as never } } } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.exception.findMany({
        where,
        orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          application: {
            select: {
              id: true,
              applicationNumber: true,
              status: true,
              citizen: { select: { name: true, externalId: true } },
            },
          },
          workflowStep: { select: { stepType: true, label: true, retryCount: true, maxAttempts: true } },
        },
      }),
      prisma.exception.count({ where }),
    ]);

    return ok(res, {
      items: rows.map((e) => ({
        id: e.id,
        type: e.type,
        severity: e.severity,
        status: e.status,
        message: e.message,
        retryCount: e.retryCount,
        details: e.details,
        createdAt: e.createdAt.toISOString(),
        resolvedAt: e.resolvedAt?.toISOString() ?? null,
        resolutionNotes: e.resolutionNotes,
        application: e.application
          ? {
              id: e.application.id,
              applicationNumber: e.application.applicationNumber,
              status: e.application.status,
              citizenName: e.application.citizen.name,
              citizenExternalId: e.application.citizen.externalId,
            }
          : null,
        step: e.workflowStep,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),
);

const resolveSchema = z.object({
  notes: z.string().trim().min(3).max(1000),
  status: z
    .enum([ExceptionStatus.RESOLVED, ExceptionStatus.ACKNOWLEDGED, ExceptionStatus.IGNORED])
    .default(ExceptionStatus.RESOLVED),
});

officerRouter.post(
  '/exceptions/:id/resolve',
  validateBody(resolveSchema),
  handler(async (req, res) => {
    const body = req.body as z.infer<typeof resolveSchema>;
    const existing = await prisma.exception.findUnique({ where: { id: req.params.id! } });
    if (!existing) throw ApiError.notFound('Exception not found');
    if (existing.applicationId) {
      await assertOfficerScope(req, existing.applicationId);
    } else if ((await officerServiceScope(req)) !== null) {
      // Platform-level exception, and this officer is department-scoped.
      throw ApiError.notFound('Exception not found');
    }

    const updated = await resolveException(
      existing.id,
      req.user!.id,
      body.notes,
      body.status,
    );
    return ok(res, {
      id: updated.id,
      status: updated.status,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
    });
  }),
);
