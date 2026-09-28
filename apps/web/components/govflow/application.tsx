'use client';

import * as React from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Ban,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  FileText,
  Loader2,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Timer,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  formatBytes,
  formatCurrency,
  formatDateTime,
  humanise,
  relativeTime,
} from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, Separator } from '@/components/ui/misc';
import {
  ConsentBadge,
  SeverityBadge,
  SlaBadge,
  StepBadge,
  ValidationBadge,
} from './status';
import type {
  ApplicationDetail,
  ConsentRecord,
  DepartmentAcknowledgementRecord,
  DocumentRecord,
  ExceptionRecord,
  ReconciliationReport,
  ReconciliationVerdict,
  TimelineEntry,
  TimeSavedReport,
  ValidationReport,
} from '@/lib/types';

// ---------------------------------------------------------------------------
// Workflow timeline
// ---------------------------------------------------------------------------

function stepIcon(status: string) {
  switch (status) {
    case 'COMPLETED':
      return <CheckCircle2 className="h-4 w-4 text-success" />;
    case 'IN_PROGRESS':
      return <Loader2 className="h-4 w-4 animate-spin text-info" />;
    case 'RETRYING':
      return <RotateCw className="h-4 w-4 animate-spin text-warning" />;
    case 'REQUIRES_REVIEW':
      return <AlertTriangle className="h-4 w-4 text-warning" />;
    case 'FAILED':
    case 'REJECTED':
      return <Ban className="h-4 w-4 text-destructive" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground/50" />;
  }
}

export function WorkflowTimeline({ timeline }: { timeline: TimelineEntry[] }) {
  if (timeline.length === 0) {
    return <EmptyState title="No workflow yet" description="The workflow has not been started." />;
  }

  return (
    <ol className="relative space-y-0">
      {timeline.map((step, index) => {
        const last = index === timeline.length - 1;
        const done = step.status === 'COMPLETED';
        return (
          <li key={step.stepType} className="relative flex gap-3 pb-5 last:pb-0">
            {!last ? (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[7px] top-6 h-full w-px',
                  done ? 'bg-success/40' : 'bg-border',
                )}
              />
            ) : null}
            <span className="relative z-10 mt-0.5 shrink-0">{stepIcon(step.status)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('text-sm font-medium', !done && 'text-foreground')}>
                  {step.order}. {step.label}
                </span>
                <StepBadge status={step.status} />
                {step.departmentName ? (
                  <Badge variant="outline" className="font-normal">
                    {step.department}
                  </Badge>
                ) : null}
                {step.retryCount > 0 ? (
                  <Badge variant="warning">
                    retry {step.retryCount}/{step.maxAttempts}
                  </Badge>
                ) : null}
                {!step.automated ? (
                  <Badge variant="secondary" className="font-normal">
                    manual
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.description}</p>
              {step.errorMessage ? (
                <p className="mt-1 rounded border border-warning/30 bg-warning/5 px-2 py-1 text-xs text-foreground">
                  {step.errorMessage}
                </p>
              ) : null}
              {step.completedAt ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Completed {relativeTime(step.completedAt)} · {formatDateTime(step.completedAt)}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Verification result cards - one per source system
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  citizenId: 'Identifier',
  name: 'Name',
  dateOfBirth: 'Date of birth',
  district: 'District',
  gender: 'Gender',
  identityVerified: 'Registry verified',
  annualIncome: 'Annual income',
  incomeYear: 'Assessment year',
  currency: 'Currency',
  certificateNumber: 'Certificate no.',
  institution: 'Institution',
  educationStatus: 'Enrolment status',
  course: 'Course',
  academicYear: 'Academic year',
  percentage: 'Marks (%)',
  verificationStatus: 'Verification status',
  beneficiaryNumber: 'Beneficiary no.',
  lastUpdated: 'Last updated',
};

function renderValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (key === 'annualIncome' && typeof value === 'number') return formatCurrency(value);
  return String(value);
}

function SourceCard({
  title,
  code,
  facts,
  source,
}: {
  title: string;
  code: string;
  facts: Record<string, unknown> | null;
  source?: {
    sourceSystem: string;
    sourceRecordId: string;
    mappingName: string;
    qualityWarnings: string[];
    receivedAt: string;
  };
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          {facts ? (
            <Badge variant="success">
              <BadgeCheck className="h-3 w-3" /> Verified
            </Badge>
          ) : (
            <Badge variant="muted">No data</Badge>
          )}
        </div>
        {source ? (
          <CardDescription className="text-[11px]">
            {source.sourceRecordId} · mapping <code className="font-mono">{source.mappingName}</code>
          </CardDescription>
        ) : (
          <CardDescription className="text-[11px]">
            {code} lookup has not returned data for this application.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {facts ? (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            {Object.entries(facts).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-2 sm:block">
                <dt className="text-xs text-muted-foreground">{FIELD_LABELS[key] ?? key}</dt>
                <dd className="font-medium tabular-nums">{renderValue(key, value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">Awaiting verification.</p>
        )}
        {source && source.qualityWarnings.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {source.qualityWarnings.map((w) => (
              <li key={w} className="flex gap-1.5 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="text-foreground">{w}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function VerificationGrid({ detail }: { detail: ApplicationDetail }) {
  const { verification } = detail;
  const source = (dataType: string) =>
    verification.sources.find((s) => s.dataType === dataType);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <SourceCard
        title="Identity Registry"
        code="IDENTITY"
        facts={verification.identity}
        source={source('IDENTITY')}
      />
      <SourceCard
        title="Income Department"
        code="INCOME"
        facts={verification.income}
        source={source('INCOME')}
      />
      <SourceCard
        title="Education Department"
        code="EDUCATION"
        facts={verification.education}
        source={source('EDUCATION')}
      />
      <SourceCard
        title="Legacy Beneficiary System (CSV)"
        code="LEGACY"
        facts={verification.legacy}
        source={source('LEGACY_BENEFICIARY')}
      />
    </div>
  );
}

export function ConsolidatedProfile({ detail }: { detail: ApplicationDetail }) {
  const { consolidated } = detail.verification;
  const entries = Object.entries(consolidated).filter(([key]) => key !== 'provenance');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4" /> Common data model
        </CardTitle>
        <CardDescription>
          Four systems, four schemas, four identifier keyspaces — resolved into one record.
          Every field carries its source.
        </CardDescription>
      </CardHeader>
      <CardContent className="scroll-x">
        <table className="data-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Value</th>
              <th>Source of record</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <td className="text-muted-foreground">{FIELD_LABELS[key] ?? key}</td>
                <td className="font-medium">{renderValue(key, value)}</td>
                <td>
                  <Badge variant="outline" className="font-normal">
                    {consolidated.provenance[key] ?? '—'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// AI / rule-based validation report
// ---------------------------------------------------------------------------

export function ValidationPanel({ report }: { report: ValidationReport | null }) {
  if (!report) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Validation</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Data-quality checks have not run yet for this application.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4" /> Validation findings
          </CardTitle>
          <div className="flex items-center gap-2">
            <ValidationBadge status={report.status} />
            <Badge variant={report.engine === 'GEMINI' ? 'info' : 'muted'}>
              {report.engine === 'GEMINI' ? 'AI-assisted' : 'Rule-based'}
            </Badge>
          </div>
        </div>
        <CardDescription>{report.summary}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert variant="info">
          <strong>Advisory only.</strong> GovFlow never decides eligibility. These findings
          support the reviewing officer, who makes the decision. <br />
          <span className="text-xs">{report.engineNote}</span>
        </Alert>

        {report.findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> No inconsistencies detected across sources.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.findings.map((finding, i) => (
              <li
                key={`${finding.kind}-${finding.field}-${i}`}
                className="rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={finding.severity} />
                  <span className="text-sm font-medium">{humanise(finding.kind)}</span>
                  <Badge variant="outline" className="font-normal">
                    {finding.field}
                  </Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    confidence {(finding.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="mt-1.5 text-sm">{finding.message}</p>
                {finding.observed && Object.keys(finding.observed).length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(finding.observed).map(([source, value]) => (
                      <span
                        key={source}
                        className="rounded border border-border bg-muted/60 px-2 py-1 text-xs"
                      >
                        <span className="text-muted-foreground">{source}: </span>
                        <span className="font-medium">
                          {value === null ? 'missing' : String(value)}
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Consent, documents, exceptions
// ---------------------------------------------------------------------------

export function ConsentPanel({
  consents,
  onGrant,
  busy,
}: {
  consents: ConsentRecord[];
  onGrant?: (departmentCode: string, granted: boolean) => Promise<void>;
  busy?: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4" /> Consent ledger
        </CardTitle>
        <CardDescription>
          No department is contacted until the matching consent is granted. Each entry records
          who asked, for what purpose, and when.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {consents.map((consent) => (
          <div
            key={consent.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{consent.departmentName}</span>
                <ConsentBadge status={consent.status} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{consent.purpose}</p>
              {consent.grantedAt ? (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Granted {formatDateTime(consent.grantedAt)}
                  {consent.expiresAt ? ` · expires ${formatDateTime(consent.expiresAt)}` : ''}
                </p>
              ) : null}
            </div>
            {onGrant ? (
              <div className="flex gap-2">
                {consent.status !== 'GRANTED' ? (
                  <Button
                    size="sm"
                    disabled={busy === consent.departmentCode}
                    onClick={() => void onGrant(consent.departmentCode, true)}
                  >
                    {busy === consent.departmentCode ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Grant
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === consent.departmentCode}
                    onClick={() => void onGrant(consent.departmentCode, false)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function DocumentsPanel({
  applicationId,
  documents,
}: {
  applicationId: string;
  documents: DocumentRecord[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <FileText className="h-4 w-4" /> Documents ({documents.length})
        </CardTitle>
        <CardDescription>
          Uploaded certificates with the fields extracted by OCR and the validation engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents uploaded.</p>
        ) : (
          documents.map((doc) => {
            const fields = (doc.extractedData ?? {}) as Record<string, unknown>;
            const populated = Object.entries(fields).filter(
              ([key, value]) =>
                value !== null && value !== undefined && key !== 'rawTextLength' && key !== 'documentType',
            );
            return (
              <div key={doc.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{humanise(doc.documentType)}</span>
                  <ValidationBadge status={doc.validationStatus} />
                  {doc.extractionEngine ? (
                    <Badge variant="outline" className="font-mono text-[10px] font-normal">
                      {doc.extractionEngine}
                    </Badge>
                  ) : null}
                  <a
                    className="ml-auto text-xs text-primary underline-offset-2 hover:underline"
                    href={api.documentUrl(applicationId, doc.id)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View file
                  </a>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {doc.fileName} · {formatBytes(doc.sizeBytes)} · uploaded{' '}
                  {relativeTime(doc.uploadedAt)}
                </p>
                {populated.length > 0 ? (
                  <>
                    <Separator className="my-2" />
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      {populated.map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-muted-foreground">{FIELD_LABELS[key] ?? key}</dt>
                          <dd className="font-medium">{renderValue(key, value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : null}
                {doc.validationNotes ? (
                  <p className="mt-2 text-[11px] text-muted-foreground">{doc.validationNotes}</p>
                ) : null}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

export function ExceptionsPanel({
  exceptions,
  onResolve,
}: {
  exceptions: ExceptionRecord[];
  onResolve?: (id: string) => Promise<void>;
}) {
  const open = exceptions.filter((e) => e.status === 'OPEN' || e.status === 'ACKNOWLEDGED');
  const closed = exceptions.filter((e) => e.status !== 'OPEN' && e.status !== 'ACKNOWLEDGED');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4" /> Exceptions ({open.length} open)
        </CardTitle>
        <CardDescription>
          Every exhausted retry and unresolved mismatch lands here as a work item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {exceptions.length === 0 ? (
          <p className="text-sm text-success">No exceptions on this application.</p>
        ) : null}
        {[...open, ...closed].map((exception) => (
          <div
            key={exception.id}
            className={cn(
              'rounded-md border p-3',
              exception.status === 'OPEN' ? 'border-destructive/30 bg-destructive/5' : 'border-border',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={exception.severity} />
              <span className="text-sm font-medium">{humanise(exception.type)}</span>
              <Badge variant={exception.status === 'OPEN' ? 'destructive' : 'muted'}>
                {humanise(exception.status)}
              </Badge>
              {exception.retryCount > 0 ? (
                <Badge variant="warning">{exception.retryCount} retries</Badge>
              ) : null}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {relativeTime(exception.createdAt)}
              </span>
            </div>
            <p className="mt-1.5 text-sm">{exception.message}</p>
            {exception.resolutionNotes ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Resolution: {exception.resolutionNotes}
              </p>
            ) : null}
            {onResolve && exception.status === 'OPEN' ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => void onResolve(exception.id)}
              >
                Mark resolved
              </Button>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function SlaCard({ detail }: { detail: ApplicationDetail }) {
  const { sla } = detail;
  const consumed = Math.min(100, (sla.elapsedHours / (sla.targetDays * 24)) * 100);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Clock className="h-4 w-4" /> Service level
          </CardTitle>
          <SlaBadge status={sla.status} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              sla.status === 'OVERDUE'
                ? 'bg-destructive'
                : sla.status === 'AT_RISK'
                  ? 'bg-warning'
                  : 'bg-success',
            )}
            style={{ width: `${consumed}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {sla.elapsedHours.toFixed(1)}h elapsed of a {sla.targetDays}-day target · due{' '}
          {formatDateTime(sla.dueAt)}
        </p>
        <ul className="mt-2 space-y-0.5">
          {sla.reasons.map((reason) => (
            <li key={reason} className="text-xs text-muted-foreground">
              • {reason}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AuditTable({ entries }: { entries: ApplicationDetail['auditTrail'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Audit trail</CardTitle>
        <CardDescription>
          Every consent, department lookup and decision is recorded. Document contents and
          credentials are never logged.
        </CardDescription>
      </CardHeader>
      <CardContent className="scroll-x">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap text-xs text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td>
                  <Badge variant="outline" className="font-mono text-[10px] font-normal">
                    {entry.action}
                  </Badge>
                </td>
                <td className="text-xs">{entry.actor?.name ?? 'system'}</td>
                <td className="max-w-md truncate text-xs text-muted-foreground">
                  {entry.metadata ? JSON.stringify(entry.metadata) : '—'}
                </td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                  No audit entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

/**
 * RECONCILIATION PANEL
 *
 * The screen that makes pre-fill defensible rather than merely convenient.
 * Three columns because two would collapse the distinction that matters: a
 * value the citizen changed and a registry that moved since look identical
 * unless you can see what the citizen was actually shown.
 */
const VERDICT_STYLE: Record<
  ReconciliationVerdict,
  { label: string; tone: string; dot: string }
> = {
  MATCH: {
    label: 'Matches registry',
    tone: 'text-emerald-700 dark:text-emerald-400',
    dot: 'bg-emerald-500',
  },
  CITIZEN_EDITED: {
    label: 'Changed by applicant',
    tone: 'text-amber-700 dark:text-amber-400',
    dot: 'bg-amber-500',
  },
  REGISTRY_CHANGED: {
    label: 'Registry changed since',
    tone: 'text-sky-700 dark:text-sky-400',
    dot: 'bg-sky-500',
  },
  DIVERGENT: {
    label: 'All three differ',
    tone: 'text-destructive',
    dot: 'bg-destructive',
  },
  AWAITING_VERIFICATION: {
    label: 'Not yet verified',
    tone: 'text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
  CITIZEN_DECLARED: {
    label: 'Declared by applicant',
    tone: 'text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
  NO_EVIDENCE: {
    label: 'No registry value',
    tone: 'text-muted-foreground',
    dot: 'bg-muted-foreground/50',
  },
};

function cell(value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'number' ? value.toLocaleString('en-IN') : String(value);
}

export function ReconciliationPanel({ report }: { report: ReconciliationReport }) {
  if (!report.available) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Reconciliation</CardTitle>
          <CardDescription>
            This application was submitted without pre-fill, so there is nothing recorded
            about what the applicant was shown.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Deliberately not an empty table: "nothing was checked" is a very
              different claim from "nothing diverged". */}
          <Alert variant="warning">
            No reconciliation is available for this application. Every value must be checked
            against the evidence tab by hand.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const attention = report.rows.filter(
    (r) => r.verdict === 'CITIZEN_EDITED' || r.verdict === 'DIVERGENT',
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Reconciliation
        </CardTitle>
        <CardDescription>
          What the registries said when the form was filled, what the applicant submitted,
          and what the registries say now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {attention.length === 0 ? (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p>
              <strong>{report.matchedCount} field(s) match the department records.</strong>{' '}
              Nothing was re-keyed or altered.
            </p>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p>
                <strong>
                  {attention.length} field(s) differ from the department record.
                </strong>
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                {attention.map((row) => (
                  <li key={row.key}>
                    {row.label}: {row.explanation}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Field</th>
                <th className="pb-2 font-medium">Shown to applicant</th>
                <th className="pb-2 font-medium">Submitted</th>
                <th className="pb-2 font-medium">Registry now</th>
                <th className="pb-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => {
                const style = VERDICT_STYLE[row.verdict];
                const changed =
                  row.verdict === 'CITIZEN_EDITED' || row.verdict === 'DIVERGENT';
                return (
                  <tr key={row.key} className="border-b border-border/60 align-top">
                    <td className="py-2">
                      <span className="font-medium">{row.label}</span>
                      {row.departmentCode ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {row.departmentCode}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 text-muted-foreground">{cell(row.prefilled)}</td>
                    <td className={cn('py-2', changed && 'font-semibold text-amber-700 dark:text-amber-400')}>
                      {cell(row.submitted)}
                    </td>
                    <td className="py-2 text-muted-foreground">{cell(row.verified)}</td>
                    <td className="py-2">
                      <span className={cn('flex items-center gap-1.5 text-xs', style.tone)}>
                        <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
                        {style.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground">
          GovFlow reports these differences; it does not decide what they mean. A changed
          value may be a correction to an out-of-date assessment.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * DEPARTMENT RECEIPT
 *
 * The custody invariant made visible. GovFlow does not become the record of
 * the decision - it hands the decision to the department that owns the
 * outcome and then shows *their* reference. If GovFlow disappeared, that
 * reference would still be the one that mattered.
 */
export function AcknowledgementPanel({
  acknowledgements,
}: {
  acknowledgements: DepartmentAcknowledgementRecord[];
}) {
  if (acknowledgements.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Database className="h-4 w-4 text-primary" />
          Recorded with the department
        </CardTitle>
        <CardDescription>
          The decision is handed back to the department that owns the outcome. Their reference
          is the authoritative one — GovFlow&rsquo;s application number only correlates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {acknowledgements.map((ack) => (
          <div key={ack.departmentCode} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{ack.departmentName}</span>
              {ack.status === 'DELIVERED' ? (
                <Badge className="gap-1 border-emerald-500/40 bg-emerald-500/10 font-normal text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Recorded
                </Badge>
              ) : ack.status === 'NOT_SUPPORTED' ? (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Ban className="h-3 w-3" /> No electronic inbox
                </Badge>
              ) : ack.status === 'FAILED' ? (
                <Badge variant="destructive" className="gap-1 font-normal">
                  <AlertTriangle className="h-3 w-3" /> Not delivered
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <Clock className="h-3 w-3" /> Sending
                </Badge>
              )}
            </div>

            {ack.departmentReference ? (
              <p className="mt-2 text-sm">
                Their reference{' '}
                <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {ack.departmentReference}
                </code>
                {ack.deliveredAt ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    {relativeTime(ack.deliveredAt)}
                  </span>
                ) : null}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                {ack.status === 'NOT_SUPPORTED'
                  ? 'This system has no electronic inbox, so the decision must be recorded there by hand. The decision itself stands.'
                  : 'No reference issued yet. The decision stands; only its delivery is outstanding.'}
              </p>
            )}

            {ack.lastError && ack.status !== 'DELIVERED' ? (
              <p className="mt-1.5 text-xs text-destructive">{ack.lastError}</p>
            ) : null}
            {ack.attempts > 0 && ack.status !== 'DELIVERED' ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {ack.attempts} delivery attempt(s)
              </p>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * TIME SAVED
 *
 * Presented as two separate things, because they are two separate things: the
 * counts are measured, the minutes are assumed, and the estimate is only the
 * product of the two. Showing the estimate alone would be the easiest way to
 * make an unfalsifiable claim, so the workings stay on the card.
 */
export function TimeSavedCard({ report }: { report: TimeSavedReport }) {
  const { measured, assumptions, estimate } = report;

  const rows: [string, number, string][] = [
    [
      'Department lookups completed',
      measured.departmentLookupsCompleted,
      `${assumptions.minutesPerManualLookup} min each by hand`,
    ],
    [
      'Form answers supplied by a registry',
      measured.fieldsPrefilled,
      `${assumptions.secondsPerFormField}s each to find and type`,
    ],
    [
      'Documents read automatically',
      measured.documentsAutoExtracted,
      `${assumptions.minutesPerManualCrossCheck} min each to transcribe`,
    ],
    [
      'Decisions filed with the department',
      measured.decisionsDelivered,
      `${assumptions.minutesPerManualLookup} min each to re-key`,
    ],
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Timer className="h-4 w-4 text-primary" />
          Effort avoided
        </CardTitle>
        <CardDescription>
          Counts are measured. Minutes per task are assumptions, and the estimate is simply
          the two multiplied.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Officer time avoided (estimated)</p>
            <p className="text-2xl font-semibold">{estimate.officerHoursSaved}h</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Citizen time avoided (estimated)</p>
            <p className="text-2xl font-semibold">{estimate.citizenHoursSaved}h</p>
          </div>
        </div>

        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, count, rate]) => (
              <tr key={label} className="border-b border-border/60">
                <td className="py-1.5">
                  <span>{label}</span>
                  <span className="block text-[11px] text-muted-foreground">{rate}</span>
                </td>
                <td className="py-1.5 text-right font-mono font-medium">{count}</td>
              </tr>
            ))}
            <tr>
              <td className="py-1.5">
                <span>Median time to a decision</span>
                <span className="block text-[11px] text-muted-foreground">
                  Measured, not modelled
                </span>
              </td>
              <td className="py-1.5 text-right font-mono font-medium">
                {measured.medianDecisionHours === null
                  ? '—'
                  : `${measured.medianDecisionHours}h`}
              </td>
            </tr>
          </tbody>
        </table>

        <p className="text-xs text-muted-foreground">{report.caveat}</p>
      </CardContent>
    </Card>
  );
}
