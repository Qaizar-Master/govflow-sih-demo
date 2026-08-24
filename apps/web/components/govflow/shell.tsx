'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  Building2,
  ClipboardList,
  FileWarning,
  Gauge,
  LayoutDashboard,
  LogOut,
  Plug,
  ScrollText,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth, usePolling } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Role } from '@/lib/types';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: Record<Role, NavItem[]> = {
  CITIZEN: [
    { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/applications', label: 'My applications', icon: ClipboardList },
    { href: '/consent', label: 'Consent', icon: ShieldCheck },
    { href: '/notifications', label: 'Notifications', icon: Bell },
    { href: '/profile', label: 'Profile', icon: UserRound },
  ],
  OFFICER: [
    { href: '/officer/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/officer/applications', label: 'Review queue', icon: ClipboardList },
    { href: '/officer/exceptions', label: 'Exceptions', icon: FileWarning },
    { href: '/notifications', label: 'Notifications', icon: Bell },
  ],
  ADMIN: [
    { href: '/admin/dashboard', label: 'Overview', icon: LayoutDashboard },
    { href: '/admin/connectors', label: 'Connectors', icon: Plug },
    { href: '/admin/departments', label: 'Departments', icon: Building2 },
    { href: '/admin/monitoring', label: 'Monitoring', icon: Gauge },
    { href: '/admin/audit', label: 'Audit log', icon: ScrollText },
    { href: '/officer/applications', label: 'All applications', icon: ClipboardList },
    { href: '/officer/exceptions', label: 'Exceptions', icon: FileWarning },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  CITIZEN: 'Citizen portal',
  OFFICER: 'Officer console',
  ADMIN: 'Administration',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, department } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const { data: notifications } = usePolling(
    () => api.get<{ unreadCount: number }>('/api/notifications?limit=1'),
    15000,
    Boolean(user),
  );

  if (!user) return <>{children}</>;

  const items = NAV[user.role];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded bg-primary-foreground/15 font-bold">
              GF
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight">GovFlow</span>
              <span className="block text-[10px] uppercase tracking-widest text-primary-foreground/70">
                {ROLE_LABEL[user.role]}
              </span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/notifications"
              className="relative rounded p-2 hover:bg-primary-foreground/10"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {notifications && notifications.unreadCount > 0 ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                  {notifications.unreadCount > 99 ? '99+' : notifications.unreadCount}
                </span>
              ) : null}
            </Link>

            <div className="hidden items-center gap-2 sm:flex">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-primary-foreground/15 text-xs font-semibold">
                {initials(user.name)}
              </span>
              <span className="leading-tight">
                <span className="block text-xs font-medium">{user.name}</span>
                <span className="block text-[10px] text-primary-foreground/70">
                  {department?.name ?? user.role}
                </span>
              </span>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              onClick={() => {
                logout();
                router.replace('/login');
              }}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </div>
        </div>
        <div className="gov-accent-bar h-[3px]" />
      </header>

      <div className="mx-auto flex max-w-[1600px] gap-6 px-4 py-6 sm:px-6">
        <nav className="hidden w-56 shrink-0 lg:block">
          <ul className="sticky top-24 space-y-1">
            {items.map((item) => {
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                      active
                        ? 'bg-primary-muted font-medium text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="sticky top-[420px] mt-6 rounded-md border border-border bg-muted/50 p-3 text-xs text-muted-foreground">
            <p className="mb-1 font-semibold text-foreground">Prototype</p>
            <p>
              All departmental systems are simulated and hold synthetic data. No real
              government registry is connected.
            </p>
          </div>
        </nav>

        {/* Mobile navigation */}
        <div className="w-full min-w-0">
          <nav className="mb-4 flex gap-1 overflow-x-auto lg:hidden">
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-sm',
                    active
                      ? 'bg-primary-muted font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  badge,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'info';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const toneClass = {
    default: 'text-foreground',
    success: 'text-success',
    warning: 'text-warning',
    destructive: 'text-destructive',
    info: 'text-info',
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon ? <Icon className={cn('h-4 w-4', toneClass)} /> : null}
      </div>
      <p className={cn('mt-2 text-2xl font-semibold tabular-nums', toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-8 text-sm text-muted-foreground">
      <Activity className="h-4 w-4 animate-pulse" />
      {label}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-medium text-destructive">Something went wrong</p>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  );
}

export function InlineBadgeCount({ count, label }: { count: number; label: string }) {
  if (count === 0) return null;
  return (
    <Badge variant="destructive">
      {count} {label}
    </Badge>
  );
}
