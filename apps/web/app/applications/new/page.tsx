'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, usePolling, useRequireRole } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';

const DEPARTMENT_LABEL: Record<string, string> = {
  IDENTITY: 'National Identity Registry',
  INCOME: 'State Income & Revenue Department',
  EDUCATION: 'Department of Higher Education',
};

interface ServiceCatalogue {
  services: {
    serviceType: string;
    name: string;
    summary: string;
    slaTargetDays: number;
    consentScopes: { departmentCode: string; purpose: string }[];
    steps: { stepType: string; label: string }[];
    departmentsUsed: string[];
    policy: { maxAnnualIncome: number | null; requiredDocuments: string[] };
  }[];
}

export default function NewApplicationPage() {
  const { ready } = useRequireRole(['CITIZEN']);
  const { citizen } = useAuth();
  const router = useRouter();

  const { data: catalogue } = usePolling(
    () => api.publicGet<ServiceCatalogue>('/api/meta/services'),
    0,
    ready,
  );

  const [serviceType, setServiceType] = React.useState('SCHOLARSHIP');
  const [amount, setAmount] = React.useState('50000');
  const [institution, setInstitution] = React.useState('');
  const [consents, setConsents] = React.useState<string[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const service = catalogue?.services.find((s) => s.serviceType === serviceType);
  const scopes = service?.consentScopes ?? [];

  // Switching service changes which departments are consulted, so the consent
  // list is rebuilt - and pre-ticked, since the citizen chose the service.
  React.useEffect(() => {
    if (service) setConsents(service.consentScopes.map((c) => c.departmentCode));
  }, [service]);

  if (!ready) return <LoadingBlock />;

  function toggle(code: string) {
    setConsents((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const data = await api.post<{ applicationId: string }>('/api/applications', {
        serviceType,
        requestedAmount: Number(amount) || undefined,
        institutionClaim: institution.trim() || undefined,
        consents,
      });
      router.replace(`/applications/${data.applicationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the application');
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="New application"
        description="You supply almost nothing. GovFlow gathers the rest from the departments that already hold it — once you authorise each lookup."
      />

      {error ? <ErrorBlock message={error} /> : null}

      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Choose a service</CardTitle>
              <CardDescription>
                Every service below runs on the same connectors. Only the departments consulted
                and the rules applied differ.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {(catalogue?.services ?? []).map((option) => {
                const selected = option.serviceType === serviceType;
                return (
                  <label
                    key={option.serviceType}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                      selected
                        ? 'border-primary bg-primary-muted/50'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="serviceType"
                      className="mt-1 h-4 w-4 accent-[var(--primary)]"
                      checked={selected}
                      onChange={() => setServiceType(option.serviceType)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{option.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {option.summary}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {option.steps.length} steps
                        </span>
                        <span className="rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {option.slaTargetDays}-day target
                        </span>
                        {option.departmentsUsed.map((code) => (
                          <span
                            key={code}
                            className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                          >
                            {code}
                          </span>
                        ))}
                      </span>
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Applicant</CardTitle>
              <CardDescription>
                From your GovFlow profile. Live registry pre-fill is not enabled yet -
                these values are not re-fetched at submission.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                {[
                  ['Name', citizen?.name],
                  ['Registry identifier', citizen?.externalId],
                  ['Date of birth', citizen?.dateOfBirth],
                  ['District', citizen?.district],
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
              <CardTitle className="text-sm">Application details</CardTitle>
              <CardDescription>
                {service?.name ?? 'Service'} ·{' '}
                {service?.policy.maxAnnualIncome
                  ? `income ceiling ₹${service.policy.maxAnnualIncome.toLocaleString('en-IN')}`
                  : 'no income ceiling'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {serviceType === 'SCHOLARSHIP' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="amount">Amount requested (₹)</Label>
                    <Input
                      id="amount"
                      type="number"
                      min={0}
                      max={1000000}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="institution">Institution (optional)</Label>
                    <Input
                      id="institution"
                      placeholder="Leave blank to use the education registry"
                      value={institution}
                      onChange={(e) => setInstitution(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground sm:col-span-2">
                  Nothing further is needed. GovFlow will collect what this service requires
                  from{' '}
                  {(service?.departmentsUsed ?? []).join(', ')} on your behalf.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4" /> Consent
              </CardTitle>
              <CardDescription>
                GovFlow contacts a department only where you authorise it. You can grant or
                revoke any of these later.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {scopes.map((scope) => {
                const checked = consents.includes(scope.departmentCode);
                return (
                  <label
                    key={scope.departmentCode}
                    className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                      checked={checked}
                      onChange={() => toggle(scope.departmentCode)}
                    />
                    <span>
                      <span className="block text-sm font-medium">
                        {DEPARTMENT_LABEL[scope.departmentCode] ?? scope.departmentCode}
                      </span>
                      <span className="block text-xs text-muted-foreground">{scope.purpose}</span>
                    </span>
                  </label>
                );
              })}
              {consents.length < scopes.length ? (
                <Alert variant="warning">
                  Verification pauses until every consent is granted. The application will still
                  be created, and you can grant the rest from the consent page.
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">What happens next</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2 text-sm text-muted-foreground">
                {[
                  'GovFlow issues an application number immediately.',
                  'Your consent is recorded against each department.',
                  'Identity, income and education lookups run in the background.',
                  'A legacy CSV export is cross-checked.',
                  'Any documents you upload are read and matched.',
                  'Mismatches are flagged for the reviewing officer.',
                  'An officer makes the final decision — not the system.',
                ].map((line, i) => (
                  <li key={line} className="flex gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
                      {i + 1}
                    </span>
                    {line}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Submit application
          </Button>
          <p className="text-xs text-muted-foreground">
            You can upload your income and education certificates on the next screen.
          </p>
        </aside>
      </form>
    </>
  );
}
