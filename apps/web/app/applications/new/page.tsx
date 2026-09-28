'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Lock,
  PencilLine,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { api, ApiClientError } from '@/lib/api';
import { useAuth, usePolling, useRequireRole } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { LoadingBlock, PageHeader } from '@/components/govflow/shell';
import type { FormSchema, PrefilledField, PrefillResult } from '@/lib/types';

const DEPARTMENT_LABEL: Record<string, string> = {
  IDENTITY: 'National Identity Registry',
  INCOME: 'State Income & Revenue Department',
  EDUCATION: 'Department of Higher Education',
  LEGACY: 'Legacy Beneficiary System',
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
    formSchema: FormSchema | null;
  }[];
}

/**
 * The application journey, in the order the product actually claims:
 *
 *   choose  →  consent  →  the form comes back answered  →  check and send
 *
 * The consent step comes before the form on purpose. GovFlow cannot answer a
 * question until the citizen has authorised the department that holds the
 * answer, and doing it in this order makes that dependency visible rather than
 * burying it in a checkbox under a submit button.
 */
type Stage = 'service' | 'consent' | 'form';

export default function NewApplicationPage() {
  const { ready } = useRequireRole(['CITIZEN']);
  const { citizen } = useAuth();
  const router = useRouter();

  const { data: catalogue } = usePolling(
    () => api.publicGet<ServiceCatalogue>('/api/meta/services'),
    0,
    ready,
  );

  const [stage, setStage] = React.useState<Stage>('service');
  const [serviceType, setServiceType] = React.useState('SCHOLARSHIP');
  const [applicationId, setApplicationId] = React.useState<string | null>(null);
  const [consents, setConsents] = React.useState<string[]>([]);
  const [prefill, setPrefill] = React.useState<PrefillResult | null>(null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const service = catalogue?.services.find((s) => s.serviceType === serviceType);
  const scopes = service?.consentScopes ?? [];
  const schema = service?.formSchema ?? null;

  React.useEffect(() => {
    if (service) setConsents(service.consentScopes.map((c) => c.departmentCode));
  }, [service]);

  if (!ready) return <LoadingBlock />;

  const prefilledByKey = new Map<string, PrefilledField>(
    (prefill?.fields ?? []).map((f) => [f.key, f]),
  );

  /** Opens the draft, so there is something for consent to attach to. */
  async function startDraft() {
    setBusy(true);
    setError(null);
    try {
      const draft = await api.post<{ applicationId: string }>('/api/applications/draft', {
        serviceType,
      });
      setApplicationId(draft.applicationId);
      setStage('consent');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the application');
    } finally {
      setBusy(false);
    }
  }

  /** Records each decision, then asks the consented departments to fill the form. */
  async function grantAndPrefill() {
    if (!applicationId) return;
    setBusy(true);
    setError(null);
    try {
      for (const scope of scopes) {
        await api.post(`/api/applications/${applicationId}/consent`, {
          departmentCode: scope.departmentCode,
          granted: consents.includes(scope.departmentCode),
        });
      }

      const result = await api.post<PrefillResult>(
        `/api/applications/${applicationId}/prefill`,
        {},
      );
      setPrefill(result);

      const next: Record<string, string> = {};
      for (const field of result.fields) {
        next[field.key] = field.value === null ? '' : String(field.value);
      }
      setValues(next);
      setStage('form');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your records');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!applicationId) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await api.post(`/api/applications/${applicationId}/submit`, { values });
      router.replace(`/applications/${applicationId}`);
    } catch (e) {
      if (e instanceof ApiClientError && e.details && typeof e.details === 'object') {
        setFieldErrors(e.details as Record<string, string>);
        setError('Some answers still need your attention.');
      } else {
        setError(e instanceof Error ? e.message : 'Could not submit the application');
      }
    } finally {
      setBusy(false);
    }
  }

  function toggle(code: string) {
    setConsents((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  const filled = prefill?.filledCount ?? 0;
  const total = prefill?.totalPrefillable ?? 0;

  return (
    <>
      <PageHeader
        title="New application"
        description="GovFlow asks the departments that already hold your details, so you only answer what none of them can."
      />

      <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
        {(
          [
            ['service', 'Choose a service'],
            ['consent', 'Authorise access'],
            ['form', 'Check and send'],
          ] as const
        ).map(([key, label], index) => {
          const order: Stage[] = ['service', 'consent', 'form'];
          const done = order.indexOf(stage) > order.indexOf(key);
          const current = stage === key;
          return (
            <li
              key={key}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1',
                current && 'border-primary bg-primary-muted font-medium',
                done && 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400',
                !current && !done && 'border-border text-muted-foreground',
              )}
            >
              {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span>{index + 1}.</span>}
              {label}
            </li>
          );
        })}
      </ol>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          {error}
        </Alert>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {stage === 'service' ? (
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
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                    selected
                      ? 'border-primary bg-primary-muted/50'
                      : 'border-border hover:bg-muted/50',
                  )}
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
                    <span className="block text-xs text-muted-foreground">{option.summary}</span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
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
            <div className="pt-2">
              <Button onClick={startDraft} disabled={busy || !service}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {stage === 'consent' ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Authorise access
            </CardTitle>
            <CardDescription>
              GovFlow reads these records to fill your form. It cannot contact a department you
              do not tick, and it never writes to any of them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {scopes.map((scope) => (
              <label
                key={scope.departmentCode}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--primary)]"
                  checked={consents.includes(scope.departmentCode)}
                  onChange={() => toggle(scope.departmentCode)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {DEPARTMENT_LABEL[scope.departmentCode] ?? scope.departmentCode}
                  </span>
                  <span className="block text-xs text-muted-foreground">{scope.purpose}</span>
                </span>
              </label>
            ))}

            <Alert variant="warning">
              Anything you decline stays blank and you fill it in yourself. Declining does not
              stop your application.
            </Alert>

            <div className="flex gap-2 pt-1">
              <Button onClick={grantAndPrefill} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Continue
              </Button>
              <Button variant="outline" onClick={() => setStage('service')} disabled={busy}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------------------------------------------------------- */}
      {stage === 'form' && schema ? (
        <form onSubmit={submit} className="space-y-6">
          <div
            className={cn(
              'flex items-start gap-3 rounded-md border p-4',
              filled > 0
                ? 'border-emerald-500/30 bg-emerald-500/5'
                : 'border-amber-500/30 bg-amber-500/5',
            )}
          >
            {filled > 0 ? (
              <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            )}
            <div className="text-sm">
              <p className="font-medium">
                {filled} of {total} answers came from the departments.
              </p>
              <p className="mt-0.5 text-muted-foreground">
                {filled > 0
                  ? 'Check them and correct anything out of date. Officers see both what you were shown and what you send.'
                  : 'No department could be reached, so please fill the form in yourself.'}
              </p>
              {(prefill?.unavailable ?? []).length > 0 ? (
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                  {prefill!.unavailable.map((u) => (
                    <li key={u.departmentCode}>
                      {DEPARTMENT_LABEL[u.departmentCode] ?? u.departmentCode}: {u.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {schema.sections.map((section) => (
            <Card key={section.title}>
              <CardHeader>
                <CardTitle className="text-sm">{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                {section.fields.map((field) => {
                  const source = prefilledByKey.get(field.key);
                  const readOnly = field.authority === 'REGISTRY' && source?.status === 'FILLED';
                  const original = source?.value === null ? '' : String(source?.value ?? '');
                  const edited = original !== '' && values[field.key] !== original;
                  const fieldError = fieldErrors[field.key];

                  return (
                    <div key={field.key} className="space-y-1.5">
                      <Label htmlFor={field.key} className="flex flex-wrap items-center gap-2">
                        {field.label}
                        {field.required ? null : (
                          <span className="text-xs text-muted-foreground">(optional)</span>
                        )}
                        {source?.status === 'FILLED' ? (
                          <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-normal text-emerald-700 dark:text-emerald-400">
                            {readOnly ? (
                              <Lock className="h-2.5 w-2.5" />
                            ) : (
                              <BadgeCheck className="h-2.5 w-2.5" />
                            )}
                            {source.source?.departmentCode}
                          </span>
                        ) : null}
                        {edited ? (
                          <span className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-700 dark:text-amber-400">
                            <PencilLine className="h-2.5 w-2.5" />
                            changed
                          </span>
                        ) : null}
                      </Label>

                      {field.type === 'select' ? (
                        <select
                          id={field.key}
                          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm"
                          value={values[field.key] ?? ''}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                        >
                          <option value="">Select…</option>
                          {(field.options ?? []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={field.key}
                          type={field.type === 'number' ? 'number' : field.type}
                          readOnly={readOnly}
                          placeholder={field.placeholder}
                          className={cn(readOnly && 'bg-muted text-muted-foreground')}
                          value={values[field.key] ?? ''}
                          onChange={(e) =>
                            setValues((v) => ({ ...v, [field.key]: e.target.value }))
                          }
                        />
                      )}

                      {fieldError ? (
                        <p className="text-xs text-destructive">{fieldError}</p>
                      ) : source?.note ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">{source.note}</p>
                      ) : field.helpText ? (
                        <p className="text-xs text-muted-foreground">{field.helpText}</p>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 pt-6">
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Submit application
              </Button>
              <p className="text-xs text-muted-foreground">
                Submitting as{' '}
                <span className="font-medium">{citizen?.name ?? 'your account'}</span>. Nothing is
                sent to any department until you do.
              </p>
            </CardContent>
          </Card>
        </form>
      ) : null}
    </>
  );
}
