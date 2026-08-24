'use client';

import * as React from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDate, humanise } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { SlaBadge, StatusBadge, ValidationBadge } from '@/components/govflow/status';
import type { ApplicationListItem, Paginated } from '@/lib/types';

const FILTERS = [
  { value: '', label: 'All statuses' },
  { value: 'REQUIRES_REVIEW', label: 'Flagged for review' },
  { value: 'UNDER_REVIEW', label: 'Awaiting decision' },
  { value: 'PROCESSING', label: 'Verification running' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
];

export default function OfficerQueuePage() {
  const { ready } = useRequireRole(['OFFICER', 'ADMIN']);
  const [status, setStatus] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);

  const query = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: '20' });
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [status, search, page]);

  const { data, error, loading } = usePolling(
    () => api.get<Paginated<ApplicationListItem>>(`/api/officer/applications?${query}`),
    7000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;

  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Every application across all citizens, with the evidence already gathered from four departments."
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search by application number, name or registry id"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          className="w-56"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      <Card>
        <CardContent className="scroll-x p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Application</th>
                <th>Citizen</th>
                <th>District</th>
                <th>Submitted</th>
                <th>Step</th>
                <th>Status</th>
                <th>Validation</th>
                <th>Exceptions</th>
                <th>SLA</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((application) => (
                <tr key={application.id}>
                  <td className="font-mono text-xs font-medium">
                    {application.applicationNumber}
                  </td>
                  <td className="text-xs">
                    <span className="block font-medium">{application.citizenName}</span>
                    <span className="text-muted-foreground">{application.citizenExternalId}</span>
                  </td>
                  <td className="text-xs">{application.district}</td>
                  <td className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(application.submittedAt)}
                  </td>
                  <td className="text-xs">{humanise(application.currentStep)}</td>
                  <td>
                    <StatusBadge status={application.status} />
                  </td>
                  <td>
                    <ValidationBadge status={application.validationStatus} />
                  </td>
                  <td className="text-xs tabular-nums">
                    {application.openExceptions > 0 ? (
                      <span className="font-medium text-destructive">
                        {application.openExceptions}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
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
              {items.length === 0 && !loading ? (
                <tr>
                  <td colSpan={10} className="py-10 text-center text-sm text-muted-foreground">
                    No applications match this filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {data && data.total > data.pageSize ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {data.page} of {totalPages} · {data.total} applications
          </span>
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
      ) : null}
    </>
  );
}
