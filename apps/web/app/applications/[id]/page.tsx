'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { Loader2, RefreshCw, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatCurrency, formatDateTime, humanise } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { SlaBadge, StatusBadge } from '@/components/govflow/status';
import {
  AuditTable,
  ConsentPanel,
  ConsolidatedProfile,
  DocumentsPanel,
  ExceptionsPanel,
  SlaCard,
  ValidationPanel,
  VerificationGrid,
  WorkflowTimeline,
} from '@/components/govflow/application';
import type { ApplicationDetail } from '@/lib/types';

const DOCUMENT_TYPES = [
  { value: 'INCOME_CERTIFICATE', label: 'Income certificate' },
  { value: 'EDUCATION_CERTIFICATE', label: 'Bonafide / education certificate' },
  { value: 'IDENTITY_PROOF', label: 'Identity proof' },
  { value: 'OTHER', label: 'Other' },
];

export default function CitizenApplicationDetail() {
  const { ready } = useRequireRole(['CITIZEN']);
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, error, loading, reload } = usePolling(
    () => api.get<ApplicationDetail>(`/api/applications/${id}`),
    5000,
    ready && Boolean(id),
  );

  const [consentBusy, setConsentBusy] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [uploadType, setUploadType] = React.useState('INCOME_CERTIFICATE');
  const [message, setMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock label="Loading application…" />;

  const { application, citizen } = data;

  async function onGrant(departmentCode: string, granted: boolean) {
    setConsentBusy(departmentCode);
    setActionError(null);
    try {
      const result = await api.post<{ workflowResumed: boolean }>(
        `/api/applications/${id}/consent`,
        { departmentCode, granted },
      );
      setMessage(
        result.workflowResumed
          ? 'All consents recorded — cross-department verification has started.'
          : `Consent for ${departmentCode} updated.`,
      );
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not update consent');
    } finally {
      setConsentBusy(null);
    }
  }

  async function onUpload(event: React.FormEvent) {
    event.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setActionError('Choose a file to upload.');
      return;
    }
    setUploading(true);
    setActionError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('documentType', uploadType);
      const result = await api.postForm<{ revalidationQueued: boolean }>(
        `/api/applications/${id}/documents`,
        form,
      );
      setMessage(
        result.revalidationQueued
          ? 'Document uploaded. GovFlow is re-checking your application against it.'
          : 'Document uploaded and read.',
      );
      if (fileRef.current) fileRef.current.value = '';
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function onRetry() {
    setActionError(null);
    try {
      const result = await api.post<{ message: string }>(`/api/applications/${id}/retry`);
      setMessage(result.message);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not resume the workflow');
    }
  }

  const blocked = data.exceptions.some((e) => e.status === 'OPEN');

  return (
    <>
      <PageHeader
        title={application.applicationNumber}
        description={`${humanise(application.serviceType)} · submitted ${formatDateTime(application.submittedAt)}`}
        badge={<StatusBadge status={application.status} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {blocked ? (
              <Button size="sm" onClick={() => void onRetry()}>
                Retry blocked step
              </Button>
            ) : null}
          </>
        }
      />

      {message ? (
        <Alert variant="success" className="mb-4">
          {message}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      ) : null}
      {application.status === 'APPROVED' ? (
        <Alert variant="success" className="mb-4" title="Approved">
          Decided {formatDateTime(application.decisionAt)} by{' '}
          {application.decidedBy?.name ?? 'a review officer'}.{' '}
          {application.decisionNotes}
        </Alert>
      ) : null}
      {application.status === 'REJECTED' ? (
        <Alert variant="destructive" className="mb-4" title="Rejected">
          {application.decisionNotes}
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs defaultValue="progress">
            <TabsList>
              <TabsTrigger value="progress">Progress</TabsTrigger>
              <TabsTrigger value="verification">Verification</TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
            </TabsList>

            <TabsContent value="progress" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Application timeline</CardTitle>
                  <CardDescription>
                    Live workflow state, straight from the orchestration engine.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <WorkflowTimeline timeline={data.timeline} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="verification" className="space-y-4">
              <VerificationGrid detail={data} />
              <ConsolidatedProfile detail={data} />
            </TabsContent>

            <TabsContent value="documents" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Upload className="h-4 w-4" /> Upload a certificate
                  </CardTitle>
                  <CardDescription>
                    Text, PDF, PNG or JPEG. Sample synthetic certificates ship in{' '}
                    <code className="font-mono text-xs">data/documents/</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onUpload} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <div className="space-y-1.5">
                      <Label htmlFor="documentType">Document type</Label>
                      <Select
                        id="documentType"
                        value={uploadType}
                        onChange={(e) => setUploadType(e.target.value)}
                      >
                        {DOCUMENT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="file">File</Label>
                      <input
                        id="file"
                        ref={fileRef}
                        type="file"
                        accept=".txt,.pdf,.png,.jpg,.jpeg,text/plain,application/pdf,image/png,image/jpeg"
                        className="block h-9 w-full rounded-md border border-input bg-card px-3 py-1.5 text-xs file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs"
                      />
                    </div>
                    <div className="flex items-end">
                      <Button type="submit" disabled={uploading}>
                        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Upload
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
              <DocumentsPanel applicationId={application.id} documents={data.documents} />
            </TabsContent>

            <TabsContent value="issues" className="space-y-4">
              <ValidationPanel report={application.validationSummary} />
              <ExceptionsPanel exceptions={data.exceptions} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <SlaCard detail={data} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Application</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {[
                  ['Applicant', citizen.name],
                  ['Registry id', citizen.externalId],
                  ['District', citizen.district],
                  ['Amount requested', formatCurrency(application.requestedAmount)],
                  ['Current step', humanise(application.currentStep)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <ConsentPanel consents={data.consents} onGrant={onGrant} busy={consentBusy} />
          <SlaBadgeLegend />
        </aside>
      </div>

      <div className="mt-6">
        <AuditTable entries={data.auditTrail} />
      </div>
    </>
  );
}

function SlaBadgeLegend() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">What the SLA states mean</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 text-xs text-muted-foreground">
        <p className="flex items-center gap-2">
          <SlaBadge status="ON_TRACK" /> within the processing target
        </p>
        <p className="flex items-center gap-2">
          <SlaBadge status="AT_RISK" /> most of the window used, or blocked
        </p>
        <p className="flex items-center gap-2">
          <SlaBadge status="OVERDUE" /> past the target
        </p>
      </CardContent>
    </Card>
  );
}
