'use client';

import Link from 'next/link';
import { CheckCircle2, ClipboardList, Clock, FilePlus2, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDate, humanise } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/misc';
import {
  ErrorBlock,
  LoadingBlock,
  PageHeader,
  StatCard,
} from '@/components/govflow/shell';
import { SlaBadge, StatusBadge } from '@/components/govflow/status';
import type { ApplicationListItem, Paginated } from '@/lib/types';

export default function CitizenDashboard() {
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
  const inProgress = items.filter(
    (a) => !['APPROVED', 'REJECTED'].includes(a.status),
  );
  const approved = items.filter((a) => a.status === 'APPROVED');
  // "Needs your attention" means the citizen can actually do something about it.
  const needsAttention = items.filter((a) => a.status === 'AWAITING_CITIZEN_ACTION');

  return (
    <>
      <PageHeader
        title="My benefits"
        description="Track every application you have submitted across departments in one place. You never have to submit the same information twice."
        actions={
          <Button asChild>
            <Link href="/applications/new">
              <FilePlus2 className="h-4 w-4" /> New application
            </Link>
          </Button>
        }
      />

      <div className="stat-grid mb-6">
        <StatCard label="Total applications" value={items.length} icon={ClipboardList} />
        <StatCard label="In progress" value={inProgress.length} tone="info" icon={Clock} />
        <StatCard label="Approved" value={approved.length} tone="success" icon={CheckCircle2} />
        <StatCard
          label="Needs your attention"
          value={needsAttention.length}
          tone={needsAttention.length > 0 ? 'warning' : 'default'}
          icon={ShieldAlert}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-8 w-8" />}
          title="No applications yet"
          description="Start a scholarship application. GovFlow will collect what it needs from the identity, income and education departments on your behalf — with your consent."
          action={
            <Button asChild>
              <Link href="/applications/new">Start an application</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Your applications</CardTitle>
            <CardDescription>
              Status updates automatically as departments respond.
            </CardDescription>
          </CardHeader>
          <CardContent className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Application</th>
                  <th>Service</th>
                  <th>Submitted</th>
                  <th>Current step</th>
                  <th>Status</th>
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
                    <td>{humanise(application.serviceType)}</td>
                    <td className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(application.submittedAt)}
                    </td>
                    <td className="text-xs">{humanise(application.currentStep)}</td>
                    <td>
                      <StatusBadge status={application.status} />
                    </td>
                    <td>
                      <SlaBadge
                        status={application.sla.status}
                        title={application.sla.reasons.join(' ')}
                      />
                    </td>
                    <td className="text-right">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/applications/${application.id}`}>Track</Link>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {needsAttention.length > 0 ? (
        <Alert variant="warning" className="mt-6" title="Some applications need something from you">
          {needsAttention.length} application(s) are paused until you act — usually a missing
          document or an outstanding consent. Open one to see exactly what is needed.
        </Alert>
      ) : null}
    </>
  );
}
