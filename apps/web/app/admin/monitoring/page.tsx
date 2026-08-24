'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDateTime, humanise } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from '@/components/govflow/shell';
import type { PlatformMetrics } from '@/lib/types';

interface ConnectorLogRow {
  id: string;
  connector: string;
  endpoint: string;
  method: string;
  requestStatus: 'SUCCESS' | 'FAILURE';
  httpStatus: number | null;
  durationMs: number;
  errorKind: string | null;
  message: string | null;
  applicationNumber: string | null;
  createdAt: string;
}

export default function AdminMonitoringPage() {
  const { ready } = useRequireRole(['ADMIN']);
  const [connector, setConnector] = React.useState('');
  const [status, setStatus] = React.useState('');

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ pageSize: '60' });
    if (connector) params.set('connector', connector);
    if (status) params.set('status', status);
    return params.toString();
  }, [connector, status]);

  const metrics = usePolling(() => api.get<PlatformMetrics>('/api/admin/metrics'), 6000, ready);
  const logs = usePolling(
    () =>
      api.get<{ items: ConnectorLogRow[]; total: number }>(
        `/api/admin/connector-logs?${query}`,
      ),
    5000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (metrics.error) return <ErrorBlock message={metrics.error} />;
  if (!metrics.data) return <LoadingBlock />;

  const m = metrics.data;

  return (
    <>
      <PageHeader
        title="Monitoring"
        description="Request volume, connector reliability and queue depth, all backed by the same Postgres tables that hold the workflow state. No separate metrics stack."
      />

      <div className="stat-grid mb-6">
        <StatCard
          label="API requests"
          value={m.api.totalRequests}
          hint={`${m.api.totalErrors} errors · ${m.api.errorRate ?? 0}%`}
          tone={(m.api.errorRate ?? 0) > 5 ? 'warning' : 'default'}
        />
        <StatCard
          label="Connector success"
          value={m.connectors.successRate === null ? '—' : `${m.connectors.successRate}%`}
          hint={`${m.connectors.success} ok · ${m.connectors.failure} failed (24h)`}
          tone={
            m.connectors.successRate !== null && m.connectors.successRate < 95
              ? 'destructive'
              : 'success'
          }
        />
        <StatCard
          label="Queue waiting"
          value={m.queue?.waiting ?? '—'}
          hint={`${m.queue?.active ?? 0} active · ${m.queue?.failed ?? 0} failed`}
        />
        <StatCard
          label="Audit events (24h)"
          value={m.auditEventsLast24h}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Busiest API routes</CardTitle>
            <CardDescription>Since the API process started.</CardDescription>
          </CardHeader>
          <CardContent className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Route</th>
                  <th>Calls</th>
                  <th>Errors</th>
                  <th>Avg</th>
                  <th>Max</th>
                </tr>
              </thead>
              <tbody>
                {m.api.routes.map((route) => (
                  <tr key={route.route}>
                    <td className="font-mono text-[11px]">{route.route}</td>
                    <td className="tabular-nums">{route.count}</td>
                    <td
                      className={cn('tabular-nums', route.errors > 0 && 'text-destructive')}
                    >
                      {route.errors}
                    </td>
                    <td className="tabular-nums">{route.avgMs} ms</td>
                    <td className="tabular-nums">{route.maxMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Applications by status</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {Object.entries(m.applications.byStatus).map(([statusKey, count]) => {
                const pct =
                  m.applications.total === 0 ? 0 : (count / m.applications.total) * 100;
                return (
                  <li key={statusKey}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{humanise(statusKey)}</span>
                      <span className="font-medium tabular-nums">{count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Document extraction
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {Object.entries(m.documents).map(([key, count]) => (
                  <Badge key={key} variant="outline" className="font-normal">
                    {humanise(key)}: {count}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">Connector call log</CardTitle>
              <CardDescription>
                Every outbound departmental call, including the retries behind a failure.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Select
                className="h-8 w-40 text-xs"
                value={connector}
                onChange={(e) => setConnector(e.target.value)}
              >
                <option value="">All connectors</option>
                <option value="IDENTITY">IDENTITY</option>
                <option value="INCOME">INCOME</option>
                <option value="EDUCATION">EDUCATION</option>
                <option value="LEGACY">LEGACY</option>
              </Select>
              <Select
                className="h-8 w-36 text-xs"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All outcomes</option>
                <option value="SUCCESS">Success</option>
                <option value="FAILURE">Failure</option>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Connector</th>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Result</th>
                <th>Duration</th>
                <th>Application</th>
              </tr>
            </thead>
            <tbody>
              {(logs.data?.items ?? []).map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td>
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {row.connector}
                    </Badge>
                  </td>
                  <td className="text-xs">{row.method}</td>
                  <td className="max-w-xs truncate font-mono text-[11px] text-muted-foreground">
                    {row.endpoint}
                  </td>
                  <td>
                    {row.requestStatus === 'SUCCESS' ? (
                      <Badge variant="success">{row.httpStatus ?? 'OK'}</Badge>
                    ) : (
                      <Badge variant="destructive" title={row.message ?? undefined}>
                        {row.errorKind ?? row.httpStatus ?? 'FAILED'}
                      </Badge>
                    )}
                  </td>
                  <td className="tabular-nums text-xs">{row.durationMs} ms</td>
                  <td className="font-mono text-[11px] text-muted-foreground">
                    {row.applicationNumber ?? '—'}
                  </td>
                </tr>
              ))}
              {(logs.data?.items.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No connector calls match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
