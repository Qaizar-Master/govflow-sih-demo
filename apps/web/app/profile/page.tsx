'use client';

import { api } from '@/lib/api';
import { useAuth, usePolling, useRequireRole } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';

interface IdentifierLinks {
  identityAssertedAt: string | null;
  identityProviderLinked: boolean;
  links: {
    departmentCode: string;
    identifier: string;
    source: 'SEED' | 'SSO_ASSERTION' | 'OFFICER_ASSERTED';
    verifiedAt: string | null;
  }[];
}

/** What each provenance actually means, in the citizen's terms. */
const SOURCE_LABEL: Record<IdentifierLinks['links'][number]['source'], string> = {
  SEED: 'Demo data',
  SSO_ASSERTION: 'Verified by MeriPehchaan',
  OFFICER_ASSERTED: 'Entered by an officer',
};

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
  const { data: identifiers } = usePolling(
    () => api.get<IdentifierLinks>('/api/auth/me/identifiers'),
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

      {/*
        The point of this panel is provenance, not the identifiers themselves.
        A link marked "Demo data" is a synthetic guess and says so; one marked
        verified was vouched for by the identity provider at a stated time.
      */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm">How departments identify you</CardTitle>
          <CardDescription>
            Each department keys you differently. GovFlow does not guess these — it is told
            them, and records who said so.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {identifiers && identifiers.links.length > 0 ? (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Department</th>
                      <th className="pb-2 font-medium">Their identifier</th>
                      <th className="pb-2 font-medium">Source</th>
                      <th className="pb-2 font-medium">Verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    {identifiers.links.map((link) => (
                      <tr key={link.departmentCode} className="border-b border-border/60">
                        <td className="py-2 font-medium">{link.departmentCode}</td>
                        <td className="py-2 font-mono text-xs">{link.identifier}</td>
                        <td className="py-2">
                          <Badge
                            variant={link.source === 'SEED' ? 'outline' : 'secondary'}
                            className="font-normal"
                          >
                            {SOURCE_LABEL[link.source]}
                          </Badge>
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">
                          {link.verifiedAt ? formatDate(link.verifiedAt) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {identifiers.identityProviderLinked ? null : (
                <Alert variant="warning" className="mt-4">
                  These links are synthetic demo data and carry no assurance. Sign in with
                  MeriPehchaan (Simulated) to replace them with asserted, timestamped links.
                </Alert>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No departmental identifiers are on record yet, so no department can be queried on
              your behalf.
            </p>
          )}
        </CardContent>
      </Card>

      {meta ? (
        <Alert variant="warning" className="mt-6">
          {meta.disclaimer}
        </Alert>
      ) : null}
    </>
  );
}
