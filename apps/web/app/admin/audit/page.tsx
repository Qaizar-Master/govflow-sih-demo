'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import type { AuditEntry, Paginated } from '@/lib/types';

interface AuditResponse extends Paginated<AuditEntry> {
  availableActions: { action: string; count: number }[];
}

export default function AdminAuditPage() {
  const { ready } = useRequireRole(['ADMIN']);
  const [action, setAction] = React.useState('');
  const [page, setPage] = React.useState(1);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (action) params.set('action', action);
    return params.toString();
  }, [action, page]);

  const { data, error } = usePolling(
    () => api.get<AuditResponse>(`/api/admin/audit?${query}`),
    10000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock />;

  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of who did what, and every automated action GovFlow took on a citizen's behalf."
      />

      <Alert variant="info" className="mb-4">
        Document contents, credentials, tokens and raw department payloads are deliberately never
        written here — only identifiers, statuses and counts.
      </Alert>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          className="w-72"
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All actions ({data.total})</option>
          {data.availableActions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action} ({a.count})
            </option>
          ))}
        </Select>
        <span className="text-xs text-muted-foreground">
          Showing page {data.page} of {totalPages}
        </span>
      </div>

      <Card>
        <CardContent className="scroll-x p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Action</th>
                <th>Actor</th>
                <th>Resource</th>
                <th>Metadata</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td>
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {entry.action}
                    </Badge>
                  </td>
                  <td className="text-xs">
                    {entry.actor ? (
                      <>
                        <span className="block font-medium">{entry.actor.name}</span>
                        <span className="text-muted-foreground">
                          {entry.actorRole ?? entry.actor.role}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">system</span>
                    )}
                  </td>
                  <td className="text-xs">
                    <span className="block">{entry.resourceType}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {entry.resourceId.slice(0, 20)}
                    </span>
                  </td>
                  <td className="max-w-lg">
                    <code className="block truncate text-[11px] text-muted-foreground">
                      {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{data.total} entries</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
