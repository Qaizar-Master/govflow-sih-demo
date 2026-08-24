'use client';

import * as React from 'react';
import { AlertTriangle, Loader2, Plug, RotateCcw, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { relativeTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { DepartmentBadge } from './status';
import type { DepartmentHealth } from '@/lib/types';

const FAILURE_MODES = [
  { value: 'ERROR_500', label: 'HTTP 503 — service unavailable' },
  { value: 'TIMEOUT', label: 'Timeout — never responds' },
  { value: 'MALFORMED', label: 'Malformed — breaks its own contract' },
  { value: 'UNAUTHORIZED', label: 'HTTP 401 — credentials rejected' },
];

export function ConnectorHealthCard({
  health,
  onSimulate,
  onRestore,
  onTest,
  busy,
  controls = true,
}: {
  health: DepartmentHealth;
  onSimulate?: (code: string, mode: string) => Promise<void>;
  onRestore?: (code: string) => Promise<void>;
  onTest?: (code: string) => Promise<void>;
  busy?: string | null;
  controls?: boolean;
}) {
  const [mode, setMode] = React.useState(FAILURE_MODES[0]!.value);
  const failing = Boolean(health.simulatedFailureMode);
  const successRate =
    health.recentRequests === 0
      ? null
      : Math.round(
          ((health.recentRequests - health.recentFailures) / health.recentRequests) * 100,
        );

  return (
    <Card className={cn(failing && 'border-destructive/50')}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Plug className="h-4 w-4" /> {health.name}
            </CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              <code className="font-mono">{health.connector}</code> · {health.connectorType} ·{' '}
              {health.blocking ? 'blocking' : 'non-blocking'}
            </p>
          </div>
          <DepartmentBadge status={health.status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Latency</dt>
            <dd className="font-medium tabular-nums">{health.latencyMs} ms</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Avg (15 min)</dt>
            <dd className="font-medium tabular-nums">
              {health.avgLatencyMs === null ? '—' : `${health.avgLatencyMs} ms`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Requests</dt>
            <dd className="font-medium tabular-nums">{health.recentRequests}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Success rate</dt>
            <dd
              className={cn(
                'font-medium tabular-nums',
                successRate !== null && successRate < 100 && 'text-destructive',
              )}
            >
              {successRate === null ? '—' : `${successRate}%`}
            </dd>
          </div>
        </dl>

        {health.detail ? (
          <p className="text-xs text-muted-foreground">
            {health.detail} · checked {relativeTime(health.checkedAt)}
          </p>
        ) : null}

        {failing ? (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span>
              Simulated outage active:{' '}
              <Badge variant="destructive">{health.simulatedFailureMode}</Badge> — calls to this
              department are genuinely failing.
            </span>
          </div>
        ) : null}

        {controls ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {!failing ? (
              <>
                <Select
                  className="h-8 w-auto min-w-[220px] text-xs"
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                >
                  {FAILURE_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy === health.connector}
                  onClick={() => onSimulate?.(health.connector, mode)}
                >
                  {busy === health.connector ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Zap className="h-3.5 w-3.5" />
                  )}
                  Simulate failure
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="success"
                disabled={busy === health.connector}
                onClick={() => onRestore?.(health.connector)}
              >
                {busy === health.connector ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Restore service
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy === health.connector}
              onClick={() => onTest?.(health.connector)}
            >
              Test connector
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
