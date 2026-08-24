'use client';

import Link from 'next/link';
import { FilePlus2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDate, humanise } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { SlaBadge, StatusBadge, ValidationBadge } from '@/components/govflow/status';
import type { ApplicationListItem, Paginated } from '@/lib/types';

export default function MyApplicationsPage() {
  const { ready } = useRequireRole(['CITIZEN']);
  const { data, error, loading } = usePolling(
    () => api.get<Paginated<ApplicationListItem>>('/api/applications?pageSize=50'),
    6000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (loading && !data) return <LoadingBlock />;

  const items = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="My applications"
        description="Every application you have submitted, with its live cross-department status."
        actions={
          <Button asChild>
            <Link href="/applications/new">
              <FilePlus2 className="h-4 w-4" /> New application
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Submit your first application to see it tracked end to end."
          action={
            <Button asChild>
              <Link href="/applications/new">Start an application</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="scroll-x p-0">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Submitted</th>
                  <th>Step</th>
                  <th>Status</th>
                  <th>Validation</th>
                  <th>Documents</th>
                  <th>SLA</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((application) => (
                  <tr key={application.id}>
                    <td>
                      <span className="block font-mono text-xs font-medium">
                        {application.applicationNumber}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {humanise(application.serviceType)}
                      </span>
                    </td>
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
                    <td className="text-xs tabular-nums">{application.documentCount}</td>
                    <td>
                      <SlaBadge status={application.sla.status} />
                    </td>
                    <td className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/applications/${application.id}`}>Open</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
