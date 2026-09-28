'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Clock,
  Timer,
  XCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDuration, humanise } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from '@/components/govflow/shell';
import { SeverityBadge, SlaBadge, StatusBadge } from '@/components/govflow/status';
import { TimeSavedCard } from '@/components/govflow/application';
import type {
  ApplicationListItem,
  ExceptionRecord,
  OfficerMetrics,
  Paginated,
  TimeSavedReport,
} from '@/lib/types';

export default function OfficerDashboard() {
  const { ready } = useRequireRole(['OFFICER', 'ADMIN']);

  const metrics = usePolling(
    () => api.get<OfficerMetrics>('/api/officer/metrics'),
    6000,
    ready,
  );
  const queue = usePolling(
    () =>
      api.get<Paginated<ApplicationListItem>>(
        '/api/officer/applications?status=REQUIRES_REVIEW,UNDER_REVIEW,PROCESSING&pageSize=8',
      ),
    6000,
    ready,
  );
  const exceptions = usePolling(
    () =>
      api.get<Paginated<ExceptionRecord>>('/api/officer/exceptions?status=OPEN&pageSize=5'),
    6000,
    ready,
  );
  const timeSaved = usePolling(
    () => api.get<TimeSavedReport>('/api/officer/time-saved'),
    15000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (metrics.error) return <ErrorBlock message={metrics.error} />;
  if (!metrics.data) return <LoadingBlock />;

  const m = metrics.data;

  return (
    <>
      <PageHeader
        title="Officer console"
        description="Consolidated visibility across every scholarship application, whichever department the evidence came from."
        actions={
          <Button asChild size="sm">
            <Link href="/officer/applications">Open review queue</Link>
          </Button>
        }
      />

      <div className="stat-grid mb-6">
        <StatCard label="Total applications" value={m.total} icon={ClipboardList} />
        <StatCard
          label="Awaiting review"
          value={m.awaitingReview}
          tone={m.awaitingReview > 0 ? 'info' : 'default'}
          hint={`${m.requiresReview} flagged · ${m.underReview} clean`}
          icon={Clock}
        />
        <StatCard
          label="Blocked on citizen"
          value={m.awaitingCitizen}
          hint="Not in your queue — the applicant must act"
          tone={m.awaitingCitizen > 0 ? 'warning' : 'default'}
          icon={Clock}
        />
        <StatCard
          label="At SLA risk"
          value={m.atRisk}
          tone={m.atRisk > 0 ? 'warning' : 'success'}
          icon={Timer}
        />
        <StatCard
          label="Open exceptions"
          value={m.openExceptions}
          tone={m.openExceptions > 0 ? 'destructive' : 'success'}
          icon={AlertTriangle}
        />
      </div>

      <div className="stat-grid mb-6">
        <StatCard label="Approved" value={m.approved} tone="success" icon={CheckCircle2} />
        <StatCard label="Rejected" value={m.rejected} tone="destructive" icon={XCircle} />
        <StatCard
          label="Average processing time"
          value={formatDuration(m.avgProcessingHours)}
          hint="Submission to decision"
        />
        <StatCard
          label="Completion rate"
          value={
            m.total === 0
              ? '—'
              : `${Math.round(((m.approved + m.rejected) / m.total) * 100)}%`
          }
        />
      </div>

      {timeSaved.data ? (
        <div className="mb-6">
          <TimeSavedCard report={timeSaved.data} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Needs a decision</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/officer/applications">View all</Link>
              </Button>
            </div>
            <CardDescription>
              Ordered by submission date. Flagged applications carry unresolved findings.
            </CardDescription>
          </CardHeader>
          <CardContent className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Citizen</th>
                  <th>Step</th>
                  <th>Status</th>
                  <th>Issues</th>
                  <th>SLA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(queue.data?.items ?? []).map((application) => (
                  <tr key={application.id}>
                    <td className="font-mono text-xs">{application.applicationNumber}</td>
                    <td className="text-xs">
                      <span className="block font-medium">{application.citizenName}</span>
                      <span className="text-muted-foreground">
                        {application.citizenExternalId}
                      </span>
                    </td>
                    <td className="text-xs">{humanise(application.currentStep)}</td>
                    <td>
                      <StatusBadge status={application.status} />
                    </td>
                    <td className="text-xs tabular-nums">
                      {application.openExceptions > 0 ? (
                        <span className="text-destructive">
                          {application.openExceptions} open
                        </span>
                      ) : application.findingCount > 0 ? (
                        <span className="text-warning">{application.findingCount} findings</span>
                      ) : (
                        <span className="text-muted-foreground">none</span>
                      )}
                    </td>
                    <td>
                      <SlaBadge
                        status={application.sla.status}
                        title={application.sla.reasons.join(' ')}
                      />
                    </td>
                    <td className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/officer/applications/${application.id}`}>Review</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
                {(queue.data?.items.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                      Nothing waiting. The queue is clear.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">Recent exceptions</CardTitle>
              <Button asChild variant="ghost" size="sm">
                <Link href="/officer/exceptions">All</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {(exceptions.data?.items ?? []).map((exception) => (
              <Link
                key={exception.id}
                href={
                  exception.application
                    ? `/officer/applications/${exception.application.id}`
                    : '/officer/exceptions'
                }
                className="block rounded-md border border-border p-3 transition-colors hover:border-primary hover:bg-primary-muted/30"
              >
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={exception.severity} />
                  <span className="text-xs font-medium">{humanise(exception.type)}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {exception.message}
                </p>
                {exception.application ? (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {exception.application.applicationNumber}
                  </p>
                ) : null}
              </Link>
            ))}
            {(exceptions.data?.items.length ?? 0) === 0 ? (
              <p className="py-6 text-center text-sm text-success">No open exceptions.</p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
