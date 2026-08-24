'use client';

import { api } from '@/lib/api';
import { useAuth, usePolling, useRequireRole } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';

interface DepartmentMeta {
  disclaimer: string;
  departments: {
    code: string;
    name: string;
    connectorType: string;
    auth: string;
    identifierPrefix: string;
    mapping: { name: string; rules: string[] };
  }[];
}

export default function ProfilePage() {
  const { ready } = useRequireRole(['CITIZEN']);
  const { user, citizen } = useAuth();
  const { data: meta, error } = usePolling(
    () => api.publicGet<DepartmentMeta>('/api/meta/departments'),
    0,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your verified identity as GovFlow holds it, and the departments it can reach on your behalf."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Account</CardTitle>
            <CardDescription>
              GovFlow stores an identifier and contact details only. It does not copy department
              records into a new master database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ['Name', citizen?.name ?? user?.name],
                ['Email', user?.email],
                ['Role', user?.role],
                ['Registry identifier', citizen?.externalId],
                ['Date of birth', citizen ? formatDate(citizen.dateOfBirth) : '—'],
                ['District', citizen?.district],
                ['Phone', citizen?.phone ?? '—'],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="text-sm font-medium">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Connected departments</CardTitle>
            <CardDescription>
              Each speaks a different schema and authenticates differently. GovFlow adapts to
              them, not the other way round.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {meta?.departments.map((department) => (
              <div key={department.code} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{department.name}</span>
                  <Badge variant="outline" className="font-normal">
                    {department.connectorType}
                  </Badge>
                  <Badge variant="secondary" className="font-normal">
                    {department.auth}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Keyspace <code className="font-mono">{department.identifierPrefix}…</code> ·
                  mapping <code className="font-mono">{department.mapping.name}</code>
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {meta ? (
        <Alert variant="warning" className="mt-6">
          {meta.disclaimer}
        </Alert>
      ) : null}
    </>
  );
}
