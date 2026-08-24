'use client';

import * as React from 'react';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { ConsentPanel } from '@/components/govflow/application';
import { StatusBadge } from '@/components/govflow/status';
import type { ApplicationDetail, ApplicationListItem, Paginated } from '@/lib/types';

export default function ConsentPage() {
  const { ready } = useRequireRole(['CITIZEN']);
  const { data: list, error } = usePolling(
    () => api.get<Paginated<ApplicationListItem>>('/api/applications?pageSize=50'),
    8000,
    ready,
  );

  const [details, setDetails] = React.useState<ApplicationDetail[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const ids = React.useMemo(() => (list?.items ?? []).map((a) => a.id).join(','), [list]);

  const loadDetails = React.useCallback(async () => {
    if (!ids) {
      setDetails([]);
      return;
    }
    const loaded = await Promise.all(
      ids.split(',').map((id) => api.get<ApplicationDetail>(`/api/applications/${id}`)),
    );
    setDetails(loaded);
  }, [ids]);

  React.useEffect(() => {
    if (!ready) return;
    void loadDetails();
  }, [ready, loadDetails]);

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;

  async function onGrant(applicationId: string, departmentCode: string, granted: boolean) {
    setBusy(departmentCode);
    try {
      const result = await api.post<{ workflowResumed: boolean }>(
        `/api/applications/${applicationId}/consent`,
        { departmentCode, granted },
      );
      setMessage(
        result.workflowResumed
          ? 'All consents recorded — verification has resumed for that application.'
          : `Consent for ${departmentCode} updated.`,
      );
      await loadDetails();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Consent"
        description="A standing record of exactly which department GovFlow may query, for which application, and why. Revoking a consent stops future lookups against that department."
        badge={<ShieldCheck className="h-5 w-5 text-primary" />}
      />

      {message ? (
        <Alert variant="success" className="mb-4">
          {message}
        </Alert>
      ) : null}

      {details.length === 0 ? (
        <EmptyState
          title="No consents recorded"
          description="Consents are created when you submit an application."
          action={
            <Button asChild>
              <Link href="/applications/new">Start an application</Link>
            </Button>
          }
        />
      ) : (
        <div className="space-y-6">
          {details.map((detail) => (
            <Card key={detail.application.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="font-mono text-sm">
                    {detail.application.applicationNumber}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={detail.application.status} />
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/applications/${detail.application.id}`}>Open</Link>
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  Submitted {formatDate(detail.application.submittedAt)}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ConsentPanel
                  consents={detail.consents}
                  busy={busy}
                  onGrant={(code, granted) =>
                    onGrant(detail.application.id, code, granted)
                  }
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
