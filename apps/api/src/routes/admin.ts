import { Router } from 'express';
import { z } from 'zod';
import {
  DEPARTMENTS,
  env,
  getDepartmentDefinition,
  toDepartmentIdentifier,
} from '@govflow/contracts';
import {
  checkAllDepartments,
  getConnector,
  importLegacyExport,
  platformMetrics,
  prisma,
  queueStats,
  setDepartmentFailure,
} from '@govflow/core';
import { isConnectorError } from '@govflow/connector-sdk';
import { ApiError } from '../lib/api-error.js';
import { handler } from '../lib/async-handler.js';
import { ok } from '../lib/respond.js';
import { requestMetrics } from '../lib/observability.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';

export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin);

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------
adminRouter.get(
  '/metrics',
  handler(async (_req, res) =>
    ok(res, { ...(await platformMetrics()), api: requestMetrics() }),
  ),
);

adminRouter.get(
  '/health',
  handler(async (_req, res) => {
    const departments = await checkAllDepartments();
    const queue = await queueStats().catch(() => null);
    const offline = departments.filter((d) => d.status === 'OFFLINE');
    return ok(res, {
      status: offline.length === 0 ? 'HEALTHY' : 'DEGRADED',
      departments,
      queue,
      ai: {
        configured: env.aiEnabled,
        model: env.aiEnabled ? env.GEMINI_MODEL : null,
        note: env.aiEnabled
          ? 'Gemini is configured; validation is AI-assisted with the rule engine as the floor.'
          : 'AI service unavailable - rule-based validation used.',
      },
    });
  }),
);

adminRouter.get(
  '/departments',
  handler(async (_req, res) => {
    const rows = await prisma.department.findMany({ orderBy: { code: 'asc' } });
    return ok(res, {
      items: rows.map((row) => {
        const def = DEPARTMENTS.find((d) => d.code === row.code);
        return {
          id: row.id,
          code: row.code,
          name: row.name,
          type: row.type,
          connectorType: row.connectorType,
          status: row.status,
          description: row.description,
          endpoint: row.endpoint,
          blocking: row.blocking,
          simulatedFailureMode: row.simulatedFailureMode,
          lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
          lastLatencyMs: row.lastLatencyMs,
          // The contract divergence, made explicit for the demo.
          mapping: def
            ? {
                name: def.mapping.name,
                rules: def.mapping.rules.map((r) => ({
                  from: r.from,
                  to: r.to,
                  transforms: r.transforms ?? [],
                  required: Boolean(r.required),
                })),
              }
            : null,
          auth:
            def?.connector.connectorType === 'REST_JSON'
              ? def.connector.auth.kind
              : 'FILE_ACCESS',
          identifierPrefix: def?.identifierPrefix ?? null,
        };
      }),
    });
  }),
);

adminRouter.get(
  '/connectors',
  handler(async (_req, res) => ok(res, { items: await checkAllDepartments() })),
);

// ---------------------------------------------------------------------------
// Failure simulation - this genuinely breaks the department, it is not a flag
// the connector reads and short-circuits.
// ---------------------------------------------------------------------------
const simulateSchema = z.object({
  mode: z
    .enum(['ERROR_500', 'TIMEOUT', 'MALFORMED', 'UNAUTHORIZED'])
    .default('ERROR_500'),
});

adminRouter.post(
  '/connectors/:code/simulate-failure',
  validateBody(simulateSchema),
  handler(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    assertKnownDepartment(code);
    const body = req.body as z.infer<typeof simulateSchema>;

    try {
      const result = await setDepartmentFailure(code, body.mode, { userId: req.user!.id });
      return ok(res, {
        ...result,
        message: `${code} will now fail with ${body.mode}. Workflow steps that call it will retry ${env.WORKFLOW_MAX_ATTEMPTS} times before raising an exception.`,
      });
    } catch (error) {
      throw ApiError.upstream(
        `Could not reach the simulated ${code} control plane. Is the mock-departments service running?`,
        isConnectorError(error) ? error.toPublicJSON() : undefined,
      );
    }
  }),
);

adminRouter.post(
  '/connectors/:code/restore',
  handler(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    assertKnownDepartment(code);
    try {
      const result = await setDepartmentFailure(code, null, { userId: req.user!.id });
      return ok(res, {
        ...result,
        message: `${code} restored. Use "Resume" on a blocked application to re-run the failed step.`,
      });
    } catch (error) {
      throw ApiError.upstream(
        `Could not reach the simulated ${code} control plane.`,
        isConnectorError(error) ? error.toPublicJSON() : undefined,
      );
    }
  }),
);

/** Live connector probe: fetch, validate, map and return both shapes. */
const testSchema = z.object({
  citizenExternalId: z.string().trim().toUpperCase().default('CIT-1001'),
});

adminRouter.post(
  '/connectors/:code/test',
  validateBody(testSchema),
  handler(async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    assertKnownDepartment(code);
    const body = req.body as z.infer<typeof testSchema>;

    const connector = await getConnector(code);
    const identifier = toDepartmentIdentifier(body.citizenExternalId, code);
    const started = Date.now();

    try {
      const outcome = await connector.ingest(identifier);
      return ok(res, {
        ok: true,
        department: code,
        departmentIdentifier: identifier,
        durationMs: Date.now() - started,
        mapping: getDepartmentDefinition(code).mapping.name,
        // Both sides of the boundary, so the normalisation is visible.
        rawFromDepartment: outcome.raw,
        normalizedCommonModel: outcome.normalized.facts,
        qualityWarnings: outcome.qualityWarnings,
      });
    } catch (error) {
      if (isConnectorError(error)) {
        return ok(res, {
          ok: false,
          department: code,
          departmentIdentifier: identifier,
          durationMs: Date.now() - started,
          error: error.toPublicJSON(),
        });
      }
      throw error;
    }
  }),
);

// ---------------------------------------------------------------------------
// Legacy CSV ingestion (Demo 4)
// ---------------------------------------------------------------------------
adminRouter.post(
  '/legacy/import',
  handler(async (req, res) => {
    try {
      const result = await importLegacyExport({ userId: req.user!.id });
      return ok(res, {
        ...result,
        source: env.LEGACY_CSV_PATH,
        message: `Read ${result.totalRows} row(s) from the legacy export, normalised and stored ${result.imported}.`,
      });
    } catch (error) {
      if (isConnectorError(error)) {
        throw ApiError.upstream(error.message, error.toPublicJSON());
      }
      throw error;
    }
  }),
);

// ---------------------------------------------------------------------------
// Audit & connector logs
// ---------------------------------------------------------------------------
const auditQuerySchema = z.object({
  action: z.string().trim().max(60).optional(),
  resourceType: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

adminRouter.get(
  '/audit',
  validateQuery(auditQuerySchema),
  handler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof auditQuerySchema>;
    const where = {
      ...(query.action ? { action: query.action.toUpperCase() } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
    };

    const [rows, total, actions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { name: true, email: true, role: true } } },
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
    ]);

    return ok(res, {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        actor: row.user ? { name: row.user.name, role: row.user.role } : null,
        actorRole: row.actorRole,
        metadata: row.metadata,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      availableActions: actions
        .map((a) => ({ action: a.action, count: a._count._all }))
        .sort((a, b) => b.count - a.count),
    });
  }),
);

const connectorLogQuerySchema = z.object({
  connector: z.string().trim().max(24).optional(),
  status: z.enum(['SUCCESS', 'FAILURE']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

adminRouter.get(
  '/connector-logs',
  validateQuery(connectorLogQuerySchema),
  handler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof connectorLogQuerySchema>;
    const where = {
      ...(query.connector ? { connector: query.connector.toUpperCase() } : {}),
      ...(query.status ? { requestStatus: query.status as never } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.connectorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { application: { select: { applicationNumber: true } } },
      }),
      prisma.connectorLog.count({ where }),
    ]);

    return ok(res, {
      items: rows.map((row) => ({
        id: row.id,
        connector: row.connector,
        endpoint: row.endpoint,
        method: row.method,
        requestStatus: row.requestStatus,
        httpStatus: row.httpStatus,
        durationMs: row.durationMs,
        errorKind: row.errorKind,
        message: row.message,
        applicationNumber: row.application?.applicationNumber ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  }),
);

adminRouter.get(
  '/queue',
  handler(async (_req, res) => {
    const stats = await queueStats().catch(() => null);
    if (!stats) throw ApiError.upstream('Redis is not reachable, so queue depth is unknown');
    return ok(res, stats);
  }),
);

function assertKnownDepartment(code: string): void {
  if (!DEPARTMENTS.some((d) => d.code === code)) {
    throw ApiError.notFound(`Unknown department code: ${code}`);
  }
}
