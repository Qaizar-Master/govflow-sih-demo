import { Badge } from '@/components/ui/badge';
import { humanise } from '@/lib/format';
import type {
  ApplicationStatus,
  ConsentStatus,
  DepartmentStatus,
  Severity,
  SlaStatus,
  StepStatus,
} from '@/lib/types';

/**
 * One place decides what every status looks like, so a colour means the same
 * thing on the citizen, officer and admin surfaces.
 */
type Variant = 'default' | 'secondary' | 'outline' | 'success' | 'warning' | 'destructive' | 'info' | 'muted';

const APPLICATION_VARIANT: Record<ApplicationStatus, Variant> = {
  DRAFT: 'muted',
  SUBMITTED: 'info',
  PROCESSING: 'info',
  REQUIRES_REVIEW: 'warning',
  UNDER_REVIEW: 'info',
  APPROVED: 'success',
  REJECTED: 'destructive',
};

const STEP_VARIANT: Record<StepStatus, Variant> = {
  PENDING: 'muted',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  FAILED: 'destructive',
  RETRYING: 'warning',
  REQUIRES_REVIEW: 'warning',
  REJECTED: 'destructive',
  SKIPPED: 'muted',
};

const SLA_VARIANT: Record<SlaStatus, Variant> = {
  ON_TRACK: 'success',
  AT_RISK: 'warning',
  OVERDUE: 'destructive',
};

const SEVERITY_VARIANT: Record<Severity, Variant> = {
  LOW: 'muted',
  MEDIUM: 'warning',
  HIGH: 'destructive',
  CRITICAL: 'destructive',
};

const CONSENT_VARIANT: Record<ConsentStatus, Variant> = {
  PENDING: 'warning',
  GRANTED: 'success',
  DENIED: 'destructive',
  REVOKED: 'muted',
  EXPIRED: 'muted',
};

const DEPARTMENT_VARIANT: Record<DepartmentStatus, Variant> = {
  ONLINE: 'success',
  DEGRADED: 'warning',
  OFFLINE: 'destructive',
};

export function StatusBadge({ status }: { status: ApplicationStatus | string }) {
  const variant = APPLICATION_VARIANT[status as ApplicationStatus] ?? 'muted';
  return <Badge variant={variant}>{humanise(status)}</Badge>;
}

export function StepBadge({ status }: { status: StepStatus | string }) {
  const variant = STEP_VARIANT[status as StepStatus] ?? 'muted';
  return <Badge variant={variant}>{humanise(status)}</Badge>;
}

export function SlaBadge({ status, title }: { status: SlaStatus | string; title?: string }) {
  const variant = SLA_VARIANT[status as SlaStatus] ?? 'muted';
  return (
    <Badge variant={variant} title={title}>
      {humanise(status)}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: Severity | string }) {
  const variant = SEVERITY_VARIANT[severity as Severity] ?? 'muted';
  return <Badge variant={variant}>{severity}</Badge>;
}

export function ConsentBadge({ status }: { status: ConsentStatus | string }) {
  const variant = CONSENT_VARIANT[status as ConsentStatus] ?? 'muted';
  return <Badge variant={variant}>{humanise(status)}</Badge>;
}

export function DepartmentBadge({ status }: { status: DepartmentStatus | string }) {
  const variant = DEPARTMENT_VARIANT[status as DepartmentStatus] ?? 'muted';
  return <Badge variant={variant}>{humanise(status)}</Badge>;
}

export function ValidationBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="muted">Not run</Badge>;
  const variant: Variant =
    status === 'PASSED'
      ? 'success'
      : status === 'WARNING'
        ? 'warning'
        : status === 'FAILED'
          ? 'destructive'
          : 'muted';
  return <Badge variant={variant}>{humanise(status)}</Badge>;
}
