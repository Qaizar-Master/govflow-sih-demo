import {
  AuditAction,
  DEPARTMENTS,
  DepartmentStatus,
  getDepartmentDefinition,
  type DepartmentConnector,
  type HealthStatus,
} from '@govflow/contracts';
import {
  createConnector,
  type ConnectorLogEntry,
  type LegacyCsvConnector,
  type RestConnector,
} from '@govflow/connector-sdk';
import { prisma } from './db.js';
import { recordAudit } from './audit.js';
import { createLogger } from './logger.js';

const log = createLogger('connectors');

/**
 * Resolves department code -> row id for joining connector logs.
 *
 * Deliberately uncached: an in-process cache goes stale the moment the
 * department table is re-seeded or reset, and a stale id fails the foreign key
 * silently inside the logging path. One indexed lookup per connector call costs
 * nothing next to the outbound HTTP request it accompanies.
 */
async function departmentRowId(code: string): Promise<string | null> {
  const row = await prisma.department.findUnique({ where: { code }, select: { id: true } });
  return row?.id ?? null;
}

/**
 * Persists every connector call. This is what powers the admin monitoring view
 * and makes retry behaviour observable rather than asserted.
 */
function makeLogSink(applicationId?: string | null) {
  return async (entry: ConnectorLogEntry): Promise<void> => {
    const departmentId = await departmentRowId(entry.departmentCode);
    await prisma.connectorLog.create({
      data: {
        connector: entry.connector,
        departmentId,
        applicationId: applicationId ?? null,
        endpoint: entry.endpoint,
        method: entry.method,
        requestStatus: entry.requestStatus as never,
        httpStatus: entry.httpStatus,
        durationMs: entry.durationMs,
        errorKind: entry.errorKind ?? null,
        message: entry.message ?? null,
      },
    });

    if (entry.requestStatus === 'FAILURE') {
      await recordAudit({
        action: AuditAction.CONNECTOR_FAILURE,
        resourceType: 'Department',
        resourceId: entry.departmentCode,
        metadata: {
          endpoint: entry.endpoint,
          errorKind: entry.errorKind,
          httpStatus: entry.httpStatus,
          durationMs: entry.durationMs,
          applicationId: applicationId ?? null,
        },
      });
    }
  };
}

export interface GetConnectorOptions {
  /** Attributes the connector's calls to an application in the logs. */
  applicationId?: string | null;
  /** Skip the audit/log sink (used by health polling to avoid log spam). */
  silent?: boolean;
}

/**
 * Builds a department connector wired to GovFlow's logging and to the
 * admin-controlled outage state.
 *
 * REST departments fail for real (the simulated service returns errors), while
 * the file-based legacy department has its outage injected here, since there is
 * no service to break.
 */
export async function getConnector(
  code: string,
  options: GetConnectorOptions = {},
): Promise<DepartmentConnector> {
  const def = getDepartmentDefinition(code);
  const row = await prisma.department.findUnique({
    where: { code: def.code },
    select: { simulatedFailureMode: true },
  });

  return createConnector(def.code, {
    onLog: options.silent ? undefined : makeLogSink(options.applicationId),
    forceUnavailable:
      def.connector.connectorType === 'CSV_FILE' && row?.simulatedFailureMode != null,
  });
}

export interface DepartmentHealth extends HealthStatus {
  departmentId: string | null;
  name: string;
  type: string;
  connectorType: string;
  blocking: boolean;
  simulatedFailureMode: string | null;
  recentFailures: number;
  recentRequests: number;
  avgLatencyMs: number | null;
}

/** Live health for every configured department, refreshed on demand. */
export async function checkAllDepartments(): Promise<DepartmentHealth[]> {
  const since = new Date(Date.now() - 15 * 60_000);

  const results = await Promise.all(
    DEPARTMENTS.map(async (def) => {
      const connector = await getConnector(def.code, { silent: true });
      const health = await connector.healthCheck();
      const departmentId = await departmentRowId(def.code);

      const [recent, aggregate] = await Promise.all([
        prisma.connectorLog.groupBy({
          by: ['requestStatus'],
          where: { connector: def.code, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        prisma.connectorLog.aggregate({
          where: { connector: def.code, createdAt: { gte: since } },
          _avg: { durationMs: true },
        }),
      ]);

      const failures =
        recent.find((r) => r.requestStatus === 'FAILURE')?._count._all ?? 0;
      const successes =
        recent.find((r) => r.requestStatus === 'SUCCESS')?._count._all ?? 0;

      const dbRow = await prisma.department.findUnique({
        where: { code: def.code },
        select: { simulatedFailureMode: true },
      });

      if (departmentId) {
        await prisma.department.update({
          where: { id: departmentId },
          data: {
            status: health.status as never,
            lastCheckedAt: new Date(health.checkedAt),
            lastLatencyMs: health.latencyMs,
          },
        });
      }

      return {
        ...health,
        departmentId,
        name: def.name,
        type: def.type,
        connectorType: def.connector.connectorType,
        blocking: def.blocking,
        simulatedFailureMode: dbRow?.simulatedFailureMode ?? null,
        recentFailures: failures,
        recentRequests: failures + successes,
        avgLatencyMs:
          aggregate._avg.durationMs === null ? null : Math.round(aggregate._avg.durationMs),
      } satisfies DepartmentHealth;
    }),
  );

  return results;
}

export type SimulatedFailureMode = 'ERROR_500' | 'TIMEOUT' | 'MALFORMED' | 'UNAUTHORIZED';

/**
 * Turns a real outage on or off. For REST departments this reaches into the
 * simulated service's control plane, so subsequent connector calls genuinely
 * fail rather than being short-circuited in GovFlow.
 */
export async function setDepartmentFailure(
  code: string,
  mode: SimulatedFailureMode | null,
  actor: { userId?: string | null } = {},
): Promise<{ code: string; mode: string | null }> {
  const def = getDepartmentDefinition(code);
  const connector = await getConnector(def.code, { silent: true });

  if (def.connector.connectorType === 'REST_JSON') {
    await (connector as unknown as RestConnector).setSimulatedFailure(mode ?? 'OFF');
  }
  // CSV departments have no control plane; the DB flag below is the switch.

  await prisma.department.update({
    where: { code: def.code },
    data: {
      simulatedFailureMode: mode,
      status: (mode ? DepartmentStatus.OFFLINE : DepartmentStatus.ONLINE) as never,
    },
  });

  await recordAudit({
    action: mode ? AuditAction.DEPARTMENT_FAILURE_SIMULATED : AuditAction.DEPARTMENT_RESTORED,
    resourceType: 'Department',
    resourceId: def.code,
    userId: actor.userId ?? null,
    metadata: { mode },
  });

  log.warn('department failure mode changed', { code: def.code, mode });
  return { code: def.code, mode };
}

/** Bulk import of the legacy CSV export. Demo 4. */
export async function importLegacyExport(actor: { userId?: string | null } = {}) {
  const connector = (await getConnector('LEGACY')) as unknown as LegacyCsvConnector;
  const rows = connector.readAllRows();

  let imported = 0;
  const rejected: { row: number; reason: string }[] = [];

  for (const [index, row] of rows.entries()) {
    const parsed = connector.rowSchema.safeParse(row);
    if (!parsed.success) {
      rejected.push({
        row: index + 2, // +2: 1-based, plus the header line
        reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      continue;
    }
    let normalized;
    try {
      normalized = connector.transform(row);
    } catch (error) {
      rejected.push({
        row: index + 2,
        reason: error instanceof Error ? error.message : 'transformation failed',
      });
      continue;
    }

    const citizen = await prisma.citizen.findUnique({
      where: { externalId: normalized.facts.citizenId },
      select: { id: true },
    });
    if (!citizen) {
      rejected.push({
        row: index + 2,
        reason: `no GovFlow citizen matches ${normalized.facts.citizenId}`,
      });
      continue;
    }

    await prisma.normalizedRecord.create({
      data: {
        citizenId: citizen.id,
        sourceSystem: connector.getSourceSystem(),
        sourceRecordId: normalized.facts.citizenId,
        dataType: normalized.dataType as never,
        normalizedPayload: normalized.facts as never,
        qualityWarnings: [],
        mappingName: 'legacy-beneficiary-csv-v1',
      },
    });
    imported += 1;
  }

  await recordAudit({
    action: AuditAction.LEGACY_IMPORT_RUN,
    resourceType: 'Department',
    resourceId: 'LEGACY',
    userId: actor.userId ?? null,
    metadata: { totalRows: rows.length, imported, rejected: rejected.length },
  });

  return { totalRows: rows.length, imported, rejected };
}
