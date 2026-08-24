'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { usePolling, useAuth } from '@/lib/auth';
import { formatDateTime, relativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { ErrorBlock, LoadingBlock, PageHeader } from '@/components/govflow/shell';
import type { NotificationRecord } from '@/lib/types';

const ICONS = {
  INFO: Info,
  SUCCESS: CheckCircle2,
  WARNING: AlertTriangle,
  ERROR: XCircle,
} as const;

const TONE = {
  INFO: 'text-info',
  SUCCESS: 'text-success',
  WARNING: 'text-warning',
  ERROR: 'text-destructive',
} as const;

export default function NotificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const { data, error, loading, reload } = usePolling(
    () => api.get<{ unreadCount: number; items: NotificationRecord[] }>('/api/notifications?limit=60'),
    8000,
    Boolean(user),
  );

  if (authLoading) return <LoadingBlock />;
  if (!user) return <ErrorBlock message="Sign in to view notifications." />;
  if (error) return <ErrorBlock message={error} />;
  if (loading && !data) return <LoadingBlock />;

  const items = data?.items ?? [];

  async function markAll() {
    await api.post('/api/notifications/read-all');
    await reload();
  }

  async function markOne(id: string) {
    await api.patch(`/api/notifications/${id}/read`);
    await reload();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Every meaningful workflow event reaches the people who need it. The prototype polls the API rather than holding a socket open."
        actions={
          data && data.unreadCount > 0 ? (
            <Button variant="outline" size="sm" onClick={() => void markAll()}>
              Mark all read ({data.unreadCount})
            </Button>
          ) : null
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={<Bell className="h-8 w-8" />} title="Nothing yet" />
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {items.map((notification) => {
              const Icon = ICONS[notification.type] ?? Info;
              const unread = !notification.readAt;
              return (
                <div
                  key={notification.id}
                  className={cn('flex gap-3 p-4', unread && 'bg-primary-muted/40')}
                >
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', TONE[notification.type])} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{notification.title}</p>
                      {unread ? (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-label="unread" />
                      ) : null}
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {relativeTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-sm text-muted-foreground">{notification.message}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
                      <span className="text-muted-foreground">
                        {formatDateTime(notification.createdAt)}
                      </span>
                      {notification.application ? (
                        <Link
                          href={
                            user.role === 'CITIZEN'
                              ? `/applications/${notification.application.id}`
                              : `/officer/applications/${notification.application.id}`
                          }
                          className="font-mono text-primary underline-offset-2 hover:underline"
                        >
                          {notification.application.applicationNumber}
                        </Link>
                      ) : null}
                      {unread ? (
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() => void markOne(notification.id)}
                        >
                          Mark read
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </>
  );
}
