'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ClipboardList,
  Cpu,
  Layers,
  Plug,
  ScrollText,
  Timer,
} from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDuration, humanise } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Progress } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from '@/components/govflow/shell';
import { ConnectorHealthCard } from '@/components/govflow/connector-card';
import type { DepartmentHealth, PlatformMetrics } from '@/lib/types';

interface HealthPayload {
  status: string;
  departments: DepartmentHealth[];
  queue: PlatformMetrics['queue'];
  ai: { configured: boolean; model: string | null; note: string };
}

export default function AdminDashboard() {
  const { ready } = useRequireRole(['ADMIN']);
  const metrics = usePolling(
    () => api.get<PlatformMetrics>('/api/admin/metrics'),
    6000,
    ready,
  );
  const health = usePolling(() => api.get<HealthPayload>('/api/admin/health'), 10000, ready);

  if (!ready) return <LoadingBlock />;
  if (metrics.error) return <ErrorBlock message={metrics.error} />;
  if (!metrics.data) return <LoadingBlock />;

  const m = metrics.data;
  const offline = (health.data?.departments ?? []).filter((d) => d.status !== 'ONLINE');

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Integration health, workflow throughput and audit activity for the whole GovFlow deployment."
        badge={
          <Badge variant={offline.length === 0 ? 'success' : 'destructive'}>
            {offline.length === 0 ? 'All departments online' : `${offline.length} degraded`}
          </Badge>
        }
        actions={
          <Button asChild size="sm">
            <Link href="/admin/connectors">Manage connectors</Link>
          </Button>
        }
      />

      {offline.length > 0 ? (
        <Alert variant="warning" className="mb-4" title="Departments not fully available">
          {offline.map((d) => `${d.name} (${d.status})`).join(', ')}. Blocked applications will
          retry and then raise exceptions for officers.
        </Alert>
      ) : null}

      <div className="stat-grid mb-6">
        <StatCard label="Applications" value={m.applications.total} icon={ClipboardList} />
        <StatCard
          label="In flight"
          value={m.applications.pending}
          tone="info"
          hint={`${m.applications.completed} decided`}
          icon={Activity}
        />
        <StatCard
          label="Open exceptions"
          value={m.exceptions.open}
          tone={m.exceptions.open > 0 ? 'destructive' : 'success'}
          icon={AlertTriangle}
        />
        <StatCard
          label="Avg processing"
          value={formatDuration(m.avgProcessingHours)}
          icon={Timer}
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">SLA distribution</CardTitle>
            <CardDescription>Live applications only.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(
              [
                ['ON_TRACK', 'bg-success'],
                ['AT_RISK', 'bg-warning'],
                ['OVERDUE', 'bg-destructive'],
              ] as const
            ).map(([key, colour]) => {
              const total = m.sla.ON_TRACK + m.sla.AT_RISK + m.sla.OVERDUE;
              const value = m.sla[key];
              const pct = total === 0 ? 0 : (value / total) * 100;
              return (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{humanise(key)}</span>
                    <span className="font-medium tabular-nums">{value}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div className={`h-full ${colour}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plug className="h-4 w-4" /> Connector calls ({m.connectors.windowHours}h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {m.connectors.successRate === null ? '—' : `${m.connectors.successRate}%`}
              </span>
              <span className="text-xs text-muted-foreground">
                {m.connectors.success} ok · {m.connectors.failure} failed
              </span>
            </div>
            <Progress value={m.connectors.successRate ?? 0} />
            <ul className="mt-3 space-y-1.5">
              {m.connectors.perConnector.map((c) => (
                <li key={c.connector} className="flex items-center justify-between text-xs">
                  <span className="font-mono">{c.connector}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {c.success}/{c.success + c.failure}
                    {c.avgDurationMs !== null ? ` · ${c.avgDurationMs} ms` : ''}
                  </span>
                </li>
              ))}
              {m.connectors.perConnector.length === 0 ? (
                <li className="text-xs text-muted-foreground">No calls in the window.</li>
              ) : null}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Layers className="h-4 w-4" /> Queue &amp; runtime
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {[
                ['Waiting', m.queue?.waiting ?? '—'],
                ['Active', m.queue?.active ?? '—'],
                ['Completed', m.queue?.completed ?? '—'],
                ['Failed', m.queue?.failed ?? '—'],
                ['API requests', m.api.totalRequests],
                ['API errors', m.api.totalErrors],
                ['Audit events (24h)', m.auditEventsLast24h],
                ['Uptime', `${Math.round(m.api.uptimeSeconds / 60)} min`],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {health.data ? (
              <div className="mt-3 rounded-md border border-border bg-muted/40 p-2.5">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  <Cpu className="h-3.5 w-3.5" />
                  AI: {health.data.ai.configured ? health.data.ai.model : 'not configured'}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{health.data.ai.note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold">Department connectors</h2>
      <div className="grid gap-4 xl:grid-cols-2">
        {(health.data?.departments ?? []).map((department) => (
          <ConnectorHealthCard key={department.connector} health={department} controls={false} />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/audit">
            <ScrollText className="h-4 w-4" /> Audit log
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/monitoring">
            <Activity className="h-4 w-4" /> Monitoring
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/admin/departments">Departments &amp; mappings</Link>
        </Button>
      </div>
    </>
  );
}
