import * as React from 'react';
import { cn } from '@/lib/utils';

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn('h-px w-full bg-border', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

export function Alert({
  variant = 'info',
  title,
  children,
  className,
}: {
  variant?: 'info' | 'warning' | 'destructive' | 'success';
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: 'border-info/30 bg-info/5 text-foreground',
    warning: 'border-warning/30 bg-warning/5 text-foreground',
    destructive: 'border-destructive/30 bg-destructive/5 text-foreground',
    success: 'border-success/30 bg-success/5 text-foreground',
  }[variant];

  return (
    <div role="alert" className={cn('rounded-md border px-4 py-3 text-sm', styles, className)}>
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      <div className="text-muted-foreground [&_strong]:text-foreground">{children}</div>
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}
    >
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {icon ? <div className="text-muted-foreground">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
