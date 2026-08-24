import { ApplicationStatus, SlaStatus } from '@govflow/contracts';
import { prisma } from './db.js';
import { assessSla } from './sla.js';
import { queueStats } from './queue.js';

/**
 * Database-backed observability. Deliberately no Prometheus/Grafana: for a
 * prototype the same tables that hold the workflow state can answer every
 * question the admin console asks.
 */
export async function platformMetrics() {
  const since24h = new Date(Date.now() - 24 * 3_600_000);

  const [
    totalApplications,
    byStatus,
    openExceptions,
    exceptionsBySeverity,
    connectorTotals,
    connectorByDept,
    decided,
    recentAudit,
    documents,
    queue,
  ] = await Promise.all([
    prisma.application.count(),
    prisma.application.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.exception.count({ where: { status: 'OPEN' } }),
    prisma.exception.groupBy({
      by: ['severity'],
      where: { status: 'OPEN' },
      _count: { _all: true },
    }),
    prisma.connectorLog.groupBy({
      by: ['requestStatus'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
    }),
    prisma.connectorLog.groupBy({
      by: ['connector', 'requestStatus'],
      where: { createdAt: { gte: since24h } },
      _count: { _all: true },
      _avg: { durationMs: true },
    }),
    prisma.application.findMany({
      where: { decisionAt: { not: null } },
      select: { submittedAt: true, decisionAt: true },
    }),
    prisma.auditLog.count({ where: { createdAt: { gte: since24h } } }),
    prisma.document.groupBy({ by: ['extractionStatus'], _count: { _all: true } }),
    queueStats().catch(() => null),
  ]);

  const statusCounts = Object.fromEntries(
    byStatus.map((row) => [row.status, row._count._all]),
  ) as Record<string, number>;

  const pending =
    (statusCounts[ApplicationStatus.SUBMITTED] ?? 0) +
    (statusCounts[ApplicationStatus.PROCESSING] ?? 0) +
    (statusCounts[ApplicationStatus.UNDER_REVIEW] ?? 0) +
    (statusCounts[ApplicationStatus.REQUIRES_REVIEW] ?? 0);

  const completed =
    (statusCounts[ApplicationStatus.APPROVED] ?? 0) +
    (statusCounts[ApplicationStatus.REJECTED] ?? 0);

  const processingHours = decided
    .filter((a) => a.decisionAt)
    .map((a) => (a.decisionAt!.getTime() - a.submittedAt.getTime()) / 3_600_000);
  const avgProcessingHours =
    processingHours.length === 0
      ? null
      : Number(
          (processingHours.reduce((s, v) => s + v, 0) / processingHours.length).toFixed(1),
        );

  // SLA distribution over live applications.
  const live = await prisma.application.findMany({
    where: { decisionAt: null },
    select: {
      submittedAt: true,
      slaTargetDays: true,
      status: true,
      _count: { select: { exceptions: { where: { status: 'OPEN' } } } },
    },
  });
  const slaCounts = { ON_TRACK: 0, AT_RISK: 0, OVERDUE: 0 } as Record<SlaStatus, number>;
  for (const app of live) {
    const sla = assessSla({
      submittedAt: app.submittedAt,
      targetDays: app.slaTargetDays,
      hasOpenException: app._count.exceptions > 0,
      isWaitingOnOfficer:
        app.status === ApplicationStatus.UNDER_REVIEW ||
        app.status === ApplicationStatus.REQUIRES_REVIEW,
    });
    slaCounts[sla.status] += 1;
  }

  const connectorSuccess =
    connectorTotals.find((r) => r.requestStatus === 'SUCCESS')?._count._all ?? 0;
  const connectorFailure =
    connectorTotals.find((r) => r.requestStatus === 'FAILURE')?._count._all ?? 0;

  const perConnector = new Map<
    string,
    { connector: string; success: number; failure: number; avgDurationMs: number | null }
  >();
  for (const row of connectorByDept) {
    const entry =
      perConnector.get(row.connector) ??
      { connector: row.connector, success: 0, failure: 0, avgDurationMs: null };
    if (row.requestStatus === 'SUCCESS') entry.success = row._count._all;
    else entry.failure = row._count._all;
    if (row._avg.durationMs !== null) {
      entry.avgDurationMs = Math.round(row._avg.durationMs);
    }
    perConnector.set(row.connector, entry);
  }

  return {
    applications: {
      total: totalApplications,
      pending,
      completed,
      byStatus: statusCounts,
    },
    sla: slaCounts,
    exceptions: {
      open: openExceptions,
      bySeverity: Object.fromEntries(
        exceptionsBySeverity.map((r) => [r.severity, r._count._all]),
      ) as Record<string, number>,
    },
    connectors: {
      windowHours: 24,
      success: connectorSuccess,
      failure: connectorFailure,
      successRate:
        connectorSuccess + connectorFailure === 0
          ? null
          : Number(
              ((connectorSuccess / (connectorSuccess + connectorFailure)) * 100).toFixed(1),
            ),
      perConnector: [...perConnector.values()],
    },
    documents: Object.fromEntries(
      documents.map((d) => [d.extractionStatus, d._count._all]),
    ) as Record<string, number>,
    avgProcessingHours,
    auditEventsLast24h: recentAudit,
    queue,
  };
}

/** Officer-scoped summary for the officer dashboard header. */
export async function officerMetrics() {
  const [
    total,
    requiresReview,
    underReview,
    approved,
    rejected,
    openExceptions,
    awaitingCitizen,
  ] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({ where: { status: ApplicationStatus.REQUIRES_REVIEW as never } }),
    prisma.application.count({ where: { status: ApplicationStatus.UNDER_REVIEW as never } }),
    prisma.application.count({ where: { status: ApplicationStatus.APPROVED as never } }),
    prisma.application.count({ where: { status: ApplicationStatus.REJECTED as never } }),
    prisma.exception.count({ where: { status: 'OPEN' } }),
    prisma.application.count({
      where: { status: ApplicationStatus.AWAITING_CITIZEN_ACTION as never },
    }),
  ]);

  const live = await prisma.application.findMany({
    where: { decisionAt: null },
    select: {
      submittedAt: true,
      slaTargetDays: true,
      status: true,
      _count: { select: { exceptions: { where: { status: 'OPEN' } } } },
    },
  });
  const atRisk = live.filter((app) => {
    const sla = assessSla({
      submittedAt: app.submittedAt,
      targetDays: app.slaTargetDays,
      hasOpenException: app._count.exceptions > 0,
      isWaitingOnOfficer:
        app.status === ApplicationStatus.UNDER_REVIEW ||
        app.status === ApplicationStatus.REQUIRES_REVIEW,
    });
    return sla.status !== SlaStatus.ON_TRACK;
  }).length;

  const decided = await prisma.application.findMany({
    where: { decisionAt: { not: null } },
    select: { submittedAt: true, decisionAt: true },
  });
  const hours = decided.map(
    (a) => (a.decisionAt!.getTime() - a.submittedAt.getTime()) / 3_600_000,
  );

  return {
    total,
    /** Blocked on the citizen - deliberately excluded from the officer work-list. */
    awaitingCitizen,
    awaitingReview: requiresReview + underReview,
    requiresReview,
    underReview,
    approved,
    rejected,
    atRisk,
    openExceptions,
    avgProcessingHours:
      hours.length === 0
        ? null
        : Number((hours.reduce((s, v) => s + v, 0) / hours.length).toFixed(1)),
  };
}
