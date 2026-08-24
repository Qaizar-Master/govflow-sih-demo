'use client';

import * as React from 'react';
import { ArrowRight, Database, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useRequireRole } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import { ConnectorHealthCard } from '@/components/govflow/connector-card';
import type { DepartmentHealth } from '@/lib/types';

interface ProbeResult {
  ok: boolean;
  department: string;
  departmentIdentifier: string;
  durationMs: number;
  mapping?: string;
  rawFromDepartment?: unknown;
  normalizedCommonModel?: unknown;
  qualityWarnings?: string[];
  error?: { kind: string; message: string; retryable: boolean };
}

export default function AdminConnectorsPage() {
  const { ready } = useRequireRole(['ADMIN']);
  const { data, error, reload } = usePolling(
    () => api.get<{ items: DepartmentHealth[] }>('/api/admin/connectors'),
    8000,
    ready,
  );

  const [busy, setBusy] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [probe, setProbe] = React.useState<ProbeResult | null>(null);
  const [probeId, setProbeId] = React.useState('CIT-1001');
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<string | null>(null);

  if (!ready) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;

  async function run(code: string, fn: () => Promise<{ message?: string }>) {
    setBusy(code);
    setActionError(null);
    try {
      const result = await fn();
      if (result.message) setMessage(result.message);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const simulate = (code: string, mode: string) =>
    run(code, () =>
      api.post<{ message: string }>(`/api/admin/connectors/${code}/simulate-failure`, { mode }),
    );

  const restore = (code: string) =>
    run(code, () => api.post<{ message: string }>(`/api/admin/connectors/${code}/restore`));

  const test = async (code: string) => {
    setBusy(code);
    setActionError(null);
    setProbe(null);
    try {
      const result = await api.post<ProbeResult>(`/api/admin/connectors/${code}/test`, {
        citizenExternalId: probeId,
      });
      setProbe(result);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Probe failed');
    } finally {
      setBusy(null);
    }
  };

  async function importLegacy() {
    setImporting(true);
    setActionError(null);
    try {
      const result = await api.post<{
        message: string;
        imported: number;
        totalRows: number;
        rejected: { row: number; reason: string }[];
      }>('/api/admin/legacy/import');
      setImportResult(
        `${result.message}${result.rejected.length ? ` ${result.rejected.length} row(s) rejected: ${result.rejected.map((r) => `row ${r.row} (${r.reason})`).join('; ')}` : ' No rows rejected.'}`,
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Legacy import failed');
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Connectors"
        description="Live health of every department adapter. Failure simulation reaches into the simulated department itself, so calls genuinely fail, BullMQ genuinely retries, and exceptions are genuinely raised."
      />

      {message ? (
        <Alert variant="info" className="mb-4">
          {message}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="destructive" className="mb-4">
          {actionError}
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="probeId">Probe identifier</Label>
          <Input
            id="probeId"
            className="w-48"
            value={probeId}
            onChange={(e) => setProbeId(e.target.value)}
          />
        </div>
        <p className="max-w-lg pb-2 text-xs text-muted-foreground">
          &ldquo;Test connector&rdquo; performs a real fetch, schema-validates the response and maps it
          through the configured field mapping. The raw and normalised payloads are shown side by
          side.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {(data?.items ?? []).map((health) => (
          <ConnectorHealthCard
            key={health.connector}
            health={health}
            busy={busy}
            onSimulate={simulate}
            onRestore={restore}
            onTest={test}
          />
        ))}
      </div>

      {probe ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-sm">
              Probe result — {probe.department} ({probe.departmentIdentifier}) ·{' '}
              {probe.durationMs} ms
            </CardTitle>
            {probe.mapping ? (
              <CardDescription>
                Mapping <code className="font-mono">{probe.mapping}</code>
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            {probe.ok ? (
              <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Raw — department schema
                  </p>
                  <pre className="scroll-x max-h-72 rounded-md border border-border bg-muted/50 p-3 text-xs">
                    {JSON.stringify(probe.rawFromDepartment, null, 2)}
                  </pre>
                </div>
                <div className="hidden items-center lg:flex">
                  <ArrowRight className="h-5 w-5 text-muted-foreground" />
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Normalised — common data model
                  </p>
                  <pre className="scroll-x max-h-72 rounded-md border border-success/30 bg-success/5 p-3 text-xs">
                    {JSON.stringify(probe.normalizedCommonModel, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <Alert variant="destructive" title={`Connector failed (${probe.error?.kind})`}>
                {probe.error?.message}
                <br />
                <span className="text-xs">
                  Retryable: {probe.error?.retryable ? 'yes — BullMQ will back off and retry' : 'no — an exception is raised immediately'}
                </span>
              </Alert>
            )}
            {probe.qualityWarnings && probe.qualityWarnings.length > 0 ? (
              <ul className="mt-3 space-y-1 text-xs text-warning">
                {probe.qualityWarnings.map((w) => (
                  <li key={w}>• {w}</li>
                ))}
              </ul>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Database className="h-4 w-4" /> Legacy CSV ingestion
          </CardTitle>
          <CardDescription>
            The legacy department has no API — only a nightly CSV export. Running the import
            reads, schema-validates, maps and normalises every row through the same connector
            contract the REST departments use.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => void importLegacy()} disabled={importing}>
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Run legacy import
          </Button>
          {importResult ? <Alert variant="success">{importResult}</Alert> : null}
        </CardContent>
      </Card>
    </>
  );
}
