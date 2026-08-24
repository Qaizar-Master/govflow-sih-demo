'use client';

import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { DepartmentBadge } from '@/components/govflow/status';

interface AdminDepartment {
  id: string;
  code: string;
  name: string;
  type: string;
  connectorType: string;
  status: string;
  description: string;
  endpoint: string | null;
  blocking: boolean;
  simulatedFailureMode: string | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  auth: string;
  identifierPrefix: string | null;
  mapping: {
    name: string;
    rules: { from: string; to: string; transforms: string[]; required: boolean }[];
  } | null;
}

export default function AdminDepartmentsPage() {
  const { ready } = useRequireRole(['ADMIN']);
  const { data, error } = usePolling(
    () => api.get<{ items: AdminDepartment[] }>('/api/admin/departments'),
    15000,
    ready,
  );

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock />;

  return (
    <>
      <PageHeader
        title="Departments & field mappings"
        description="The interoperability surface, in full. Each department speaks a different schema, uses a different identifier keyspace and authenticates differently — the mapping below is the only place that divergence is encoded."
      />

      <Alert variant="warning" className="mb-6">
        Every department here is <strong>simulated</strong> and holds synthetic data. Onboarding a
        real department would mean adding a connector and a mapping like these — not migrating
        anyone&rsquo;s data.
      </Alert>

      <div className="space-y-6">
        {data.items.map((department) => (
          <Card key={department.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-sm">{department.name}</CardTitle>
                  <CardDescription>{department.description}</CardDescription>
                </div>
                <DepartmentBadge status={department.status} />
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                {[
                  ['Code', department.code],
                  ['Type', department.type],
                  ['Transport', department.connectorType],
                  ['Auth', department.auth],
                  ['Keyspace', `${department.identifierPrefix ?? '—'}…`],
                  ['Blocking', department.blocking ? 'Yes' : 'No'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              <p className="break-all font-mono text-xs text-muted-foreground">
                {department.endpoint}
              </p>

              {department.lastCheckedAt ? (
                <p className="text-xs text-muted-foreground">
                  Last checked {formatDateTime(department.lastCheckedAt)}
                  {department.lastLatencyMs !== null ? ` · ${department.lastLatencyMs} ms` : ''}
                </p>
              ) : null}

              {department.mapping ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Mapping <code className="font-mono normal-case">{department.mapping.name}</code>
                  </p>
                  <div className="scroll-x">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Department field</th>
                          <th />
                          <th>Common data model</th>
                          <th>Transforms</th>
                          <th>Required</th>
                        </tr>
                      </thead>
                      <tbody>
                        {department.mapping.rules.map((rule) => (
                          <tr key={`${rule.from}-${rule.to}`}>
                            <td className="font-mono text-xs">{rule.from}</td>
                            <td className="text-muted-foreground">→</td>
                            <td className="font-mono text-xs font-medium">{rule.to}</td>
                            <td>
                              <div className="flex flex-wrap gap-1">
                                {rule.transforms.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">none</span>
                                ) : (
                                  rule.transforms.map((t) => (
                                    <Badge key={t} variant="outline" className="font-normal">
                                      {t}
                                    </Badge>
                                  ))
                                )}
                              </div>
                            </td>
                            <td className="text-xs">{rule.required ? 'yes' : 'no'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
