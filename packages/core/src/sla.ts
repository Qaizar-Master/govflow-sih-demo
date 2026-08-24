import { SlaStatus, workflowConfig, type SlaAssessment } from '@govflow/contracts';

export interface SlaInput {
  submittedAt: Date;
  targetDays: number;
  /** Terminal applications stop the clock. */
  decidedAt?: Date | null;
  hasOpenException?: boolean;
  isWaitingOnOfficer?: boolean;
  now?: Date;
}

/**
 * Deterministic SLA assessment - no prediction model.
 *
 *   elapsed vs target, plus two escalating factors:
 *   an open exception, and a step parked on a human.
 */
export function assessSla(input: SlaInput): SlaAssessment {
  const now = input.now ?? new Date();
  const targetDays = input.targetDays > 0 ? input.targetDays : workflowConfig.slaTargetDays;
  const targetHours = targetDays * 24;
  const endpoint = input.decidedAt ?? now;

  const elapsedHours = Math.max(
    0,
    (endpoint.getTime() - input.submittedAt.getTime()) / 3_600_000,
  );
  const remainingHours = targetHours - elapsedHours;
  const dueAt = new Date(input.submittedAt.getTime() + targetHours * 3_600_000);
  const consumed = elapsedHours / targetHours;

  const reasons: string[] = [];
  let status: SlaStatus;

  if (input.decidedAt) {
    status = elapsedHours > targetHours ? SlaStatus.OVERDUE : SlaStatus.ON_TRACK;
    reasons.push(
      elapsedHours > targetHours
        ? `Decided after ${elapsedHours.toFixed(1)}h, past the ${targetDays}-day target.`
        : `Decided in ${elapsedHours.toFixed(1)}h, within the ${targetDays}-day target.`,
    );
    return { status, targetDays, elapsedHours, remainingHours, dueAt: dueAt.toISOString(), reasons };
  }

  if (consumed >= 1) {
    status = SlaStatus.OVERDUE;
    reasons.push(`${elapsedHours.toFixed(1)}h elapsed against a ${targetDays}-day target.`);
  } else if (consumed >= workflowConfig.slaAtRiskThreshold) {
    status = SlaStatus.AT_RISK;
    reasons.push(
      `${Math.round(consumed * 100)}% of the ${targetDays}-day window consumed.`,
    );
  } else {
    status = SlaStatus.ON_TRACK;
    reasons.push(`${Math.round(consumed * 100)}% of the ${targetDays}-day window consumed.`);
  }

  // A blocked application burns its window without progressing, so escalate.
  if (input.hasOpenException && status === SlaStatus.ON_TRACK) {
    status = SlaStatus.AT_RISK;
    reasons.push('An open exception is blocking automated progress.');
  } else if (input.hasOpenException) {
    reasons.push('An open exception is blocking automated progress.');
  }

  if (input.isWaitingOnOfficer && status === SlaStatus.ON_TRACK && consumed >= 0.5) {
    status = SlaStatus.AT_RISK;
    reasons.push('Awaiting officer review for more than half the SLA window.');
  }

  return { status, targetDays, elapsedHours, remainingHours, dueAt: dueAt.toISOString(), reasons };
}
