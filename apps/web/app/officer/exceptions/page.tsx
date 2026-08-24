'use client';

import * as React from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDateTime, humanise, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, Textarea } from '@/components/ui/input';
import { Alert, EmptyState } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader, StatCard } from '@/components/govflow/shell';
import { SeverityBadge } from '@/components/govflow/status';
import { Badge } from '@/components/ui/badge';
import type { ExceptionRecord, Paginated } from '@/lib/types';

const STATUS_FILTERS = [
  { value: 'OPEN,ACKNOWLEDGED', label: 'Open & acknowledged' },
  { value: 'OPEN', label: 'Open only' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'OPEN,ACKNOWLEDGED,RESOLVED,IGNORED', label: 'Everything' },
];

export default function ExceptionQueuePage() {
  const { ready } = useRequireRole(['OFFICER', 'ADMIN']);
  const [statusFilter, setStatusFilter] = React.useState(STATUS_FILTERS[0]!.value);
  const [severityFilter, setSeverityFilter] = React.useState('');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ status: statusFilter, pageSize: '50' });
    if (severityFilter) params.set('severity', severityFilter);
    return params.toString();
  }, [statusFilter, severityFilter]);

  const { data, error, reload } = usePolling(
    () => api.get<Paginated<ExceptionRecord>>(`/api/officer/exceptions?${query}`),
    7000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;

  const items = data?.items ?? [];
  const open = items.filter((e) => e.status === 'OPEN');
  const high = open.filter((e) => e.severity === 'HIGH' || e.severity === 'CRITICAL');
  const connector = open.filter((e) => e.type === 'CONNECTOR_FAILURE');

  async function resolve(id: string) {
    setBusy(id);
    try {
      await api.post(`/api/officer/exceptions/${id}/resolve`, {
        notes: notes.trim() || 'Reviewed by officer and accepted.',
        status: 'RESOLVED',
      });
      setExpanded(null);
      setNotes('');
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Exception queue"
        description="Every exhausted retry, data mismatch and missing document that automation could not settle. This is the human work-list."
      />

      <div className="stat-grid mb-6">
        <StatCard label="Open" value={open.length} tone={open.length ? 'warning' : 'success'} />
        <StatCard label="High severity" value={high.length} tone={high.length ? 'destructive' : 'success'} />
        <StatCard label="Connector failures" value={connector.length} tone={connector.length ? 'destructive' : 'default'} />
        <StatCard label="Shown" value={items.length} hint={`of ${data?.total ?? 0} total`} />
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <Select
          className="w-64"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
        <Select
          className="w-48"
          value={severityFilter}
          onChange={(e) => setSeverityFilter(e.target.value)}
        >
          <option value="">All severities</option>
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </Select>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No exceptions match this filter" />
      ) : (
        <div className="space-y-3">
          {items.map((exception) => (
            <Card
              key={exception.id}
              className={cn(
                exception.status === 'OPEN' &&
                  (exception.severity === 'HIGH' || exception.severity === 'CRITICAL')
                  ? 'border-destructive/40'
                  : undefined,
              )}
            >
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={exception.severity} />
                  <span className="text-sm font-medium">{humanise(exception.type)}</span>
                  <Badge variant={exception.status === 'OPEN' ? 'destructive' : 'muted'}>
                    {humanise(exception.status)}
                  </Badge>
                  {exception.retryCount > 0 ? (
                    <Badge variant="warning">
                      {exception.retryCount}/{exception.step?.maxAttempts ?? 3} attempts
                    </Badge>
                  ) : null}
                  {exception.step ? (
                    <Badge variant="outline" className="font-normal">
                      {exception.step.label}
                    </Badge>
                  ) : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {relativeTime(exception.createdAt)} · {formatDateTime(exception.createdAt)}
                  </span>
                </div>

                <p className="mt-2 text-sm">{exception.message}</p>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  {exception.application ? (
                    <>
                      <Link
                        href={`/officer/applications/${exception.application.id}`}
                        className="font-mono text-primary underline-offset-2 hover:underline"
                      >
                        {exception.application.applicationNumber}
                      </Link>
                      <span className="text-muted-foreground">
                        {exception.application.citizenName} ·{' '}
                        {exception.application.citizenExternalId}
                      </span>
                    </>
                  ) : null}
                  {exception.status === 'OPEN' ? (
                    <button
                      type="button"
                      className="ml-auto text-primary underline-offset-2 hover:underline"
                      onClick={() =>
                        setExpanded((prev) => (prev === exception.id ? null : exception.id))
                      }
                    >
                      {expanded === exception.id ? 'Cancel' : 'Resolve'}
                    </button>
                  ) : exception.resolutionNotes ? (
                    <span className="ml-auto text-muted-foreground">
                      Resolved: {exception.resolutionNotes}
                    </span>
                  ) : null}
                </div>

                {expanded === exception.id ? (
                  <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/40 p-3">
                    <Textarea
                      rows={2}
                      placeholder="Resolution note (recorded in the audit log)…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy === exception.id}
                        onClick={() => void resolve(exception.id)}
                      >
                        Mark resolved
                      </Button>
                      {exception.type === 'CONNECTOR_FAILURE' && exception.application ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/officer/applications/${exception.application.id}`}>
                            Open application to re-run the step
                          </Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {connector.length > 0 ? (
        <Alert variant="warning" className="mt-6" title="Connector failures present">
          A department is unavailable. An administrator can restore it from{' '}
          <Link href="/admin/connectors" className="text-primary underline-offset-2 hover:underline">
            Connectors
          </Link>
          , after which the blocked step can be re-run from the application page.
        </Alert>
      ) : null}
    </>
  );
}
