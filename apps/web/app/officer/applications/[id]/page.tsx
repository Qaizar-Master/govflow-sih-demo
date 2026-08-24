'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { formatCurrency, formatDateTime, humanise, relativeTime } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { StatusBadge } from '@/components/govflow/status';
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

export default function OfficerApplicationDetail() {
  const { ready } = useRequireRole(['OFFICER', 'ADMIN']);
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data, error, loading, reload } = usePolling(
    () => api.get<ApplicationDetail>(`/api/officer/applications/${id}`),
    6000,
    ready && Boolean(id),
  );

  const [decisionNotes, setDecisionNotes] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock label="Loading application…" />;

  const { application, citizen } = data;
  const decided = application.status === 'APPROVED' || application.status === 'REJECTED';
  const openExceptions = data.exceptions.filter((e) => e.status === 'OPEN');

  async function decide(decision: 'approve' | 'reject') {
    if (decisionNotes.trim().length < 5) {
      setActionError('Record a justification of at least 5 characters before deciding.');
      return;
    }
    setBusy(decision);
    setActionError(null);
    try {
      await api.post(`/api/officer/applications/${id}/${decision}`, {
        notes: decisionNotes.trim(),
      });
      setMessage(`Application ${decision === 'approve' ? 'approved' : 'rejected'}.`);
      setDecisionNotes('');
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not record the decision');
    } finally {
      setBusy(null);
    }
  }

  async function addNote() {
    if (note.trim().length < 3) return;
    setBusy('note');
    try {
      await api.post(`/api/applications/${id}/notes`, { note: note.trim() });
      setNote('');
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save the note');
    } finally {
      setBusy(null);
    }
  }

  async function resume() {
    setBusy('resume');
    setActionError(null);
    try {
      const result = await api.post<{ message: string }>(
        `/api/officer/applications/${id}/resume`,
      );
      setMessage(result.message);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not resume the workflow');
    } finally {
      setBusy(null);
    }
  }

  async function resolveException(exceptionId: string) {
    setBusy(exceptionId);
    try {
      await api.post(`/api/officer/exceptions/${exceptionId}/resolve`, {
        notes: 'Reviewed by officer and accepted.',
        status: 'RESOLVED',
      });
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Link
        href="/officer/applications"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to queue
      </Link>

      <PageHeader
        title={application.applicationNumber}
        description={`${citizen.name} (${citizen.externalId}) · ${citizen.district} · submitted ${formatDateTime(application.submittedAt)}`}
        badge={<StatusBadge status={application.status} />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {!decided ? (
              <Button size="sm" variant="outline" onClick={() => void resume()} disabled={busy === 'resume'}>
                {busy === 'resume' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Re-run blocked step
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
      {openExceptions.length > 0 && !decided ? (
        <Alert variant="warning" className="mb-4" title={`${openExceptions.length} open exception(s)`}>
          Automated processing is blocked or flagged. Review the issues tab before deciding.
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Tabs defaultValue="evidence">
            <TabsList>
              <TabsTrigger value="evidence">Evidence</TabsTrigger>
              <TabsTrigger value="issues">
                Issues{openExceptions.length > 0 ? ` (${openExceptions.length})` : ''}
              </TabsTrigger>
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="workflow">Workflow</TabsTrigger>
              <TabsTrigger value="audit">Audit</TabsTrigger>
            </TabsList>

            <TabsContent value="evidence" className="space-y-4">
              <ConsolidatedProfile detail={data} />
              <VerificationGrid detail={data} />
            </TabsContent>

            <TabsContent value="issues" className="space-y-4">
              <ValidationPanel report={application.validationSummary} />
              <ExceptionsPanel exceptions={data.exceptions} onResolve={resolveException} />
            </TabsContent>

            <TabsContent value="documents">
              <DocumentsPanel applicationId={application.id} documents={data.documents} />
            </TabsContent>

            <TabsContent value="workflow">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Workflow timeline</CardTitle>
                  <CardDescription>
                    Persisted step state including retry counts, not a UI approximation.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <WorkflowTimeline timeline={data.timeline} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="audit">
              <AuditTable entries={data.auditTrail} />
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-4">
          <Card className={decided ? undefined : 'border-primary/40'}>
            <CardHeader>
              <CardTitle className="text-sm">Officer decision</CardTitle>
              <CardDescription>
                The decision rests with you. GovFlow’s findings are advisory and the AI never
                approves or rejects.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {decided ? (
                <div className="space-y-2 text-sm">
                  <StatusBadge status={application.status} />
                  <p className="text-muted-foreground">
                    Decided {formatDateTime(application.decisionAt)} by{' '}
                    {application.decidedBy?.name ?? 'an officer'}.
                  </p>
                  <p className="rounded border border-border bg-muted/50 p-2 text-xs">
                    {application.decisionNotes}
                  </p>
                </div>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="decisionNotes">Justification (recorded in the audit log)</Label>
                    <Textarea
                      id="decisionNotes"
                      rows={4}
                      placeholder="Explain the basis for this decision…"
                      value={decisionNotes}
                      onChange={(e) => setDecisionNotes(e.target.value)}
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="success"
                      className="flex-1"
                      disabled={busy !== null}
                      onClick={() => void decide('approve')}
                    >
                      {busy === 'approve' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Approve
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      disabled={busy !== null}
                      onClick={() => void decide('reject')}
                    >
                      {busy === 'reject' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <SlaCard detail={data} />

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Application</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-2 text-sm">
                {[
                  ['Service', humanise(application.serviceType)],
                  ['Amount requested', formatCurrency(application.requestedAmount)],
                  ['Current step', humanise(application.currentStep)],
                  ['Documents', String(data.documents.length)],
                  ['Date of birth', citizen.dateOfBirth],
                  ['Contact', citizen.email ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Review notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Textarea
                  rows={3}
                  placeholder="Add an internal note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === 'note' || note.trim().length < 3}
                  onClick={() => void addNote()}
                >
                  Add note
                </Button>
              </div>
              {data.reviewNotes.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border p-2.5">
                  <p className="text-xs">{entry.note}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {entry.author.name} · {relativeTime(entry.createdAt)}
                  </p>
                </div>
              ))}
              {data.reviewNotes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No notes yet.</p>
              ) : null}
            </CardContent>
          </Card>

          <ConsentPanel consents={data.consents} />
        </aside>
      </div>
    </>
  );
}
