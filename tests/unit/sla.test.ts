import { describe, expect, it } from 'vitest';
import { SlaStatus } from '@govflow/contracts';
import { assessSla } from '@govflow/core';

const HOUR = 3_600_000;
const now = new Date('2026-08-24T12:00:00Z');
const submitted = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);

describe('SLA assessment', () => {
  it('is ON_TRACK early in the window', () => {
    const sla = assessSla({ submittedAt: submitted(6), targetDays: 5, now });
    expect(sla.status).toBe(SlaStatus.ON_TRACK);
    expect(sla.elapsedHours).toBeCloseTo(6, 1);
    expect(sla.remainingHours).toBeCloseTo(114, 1);
  });

  it('becomes AT_RISK past the 70% threshold', () => {
    // 70% of a 5-day (120h) window is 84h.
    const sla = assessSla({ submittedAt: submitted(90), targetDays: 5, now });
    expect(sla.status).toBe(SlaStatus.AT_RISK);
  });

  it('becomes OVERDUE past the target', () => {
    const sla = assessSla({ submittedAt: submitted(130), targetDays: 5, now });
    expect(sla.status).toBe(SlaStatus.OVERDUE);
    expect(sla.remainingHours).toBeLessThan(0);
  });

  it('escalates an otherwise healthy application that is blocked', () => {
    const sla = assessSla({
      submittedAt: submitted(4),
      targetDays: 5,
      hasOpenException: true,
      now,
    });
    expect(sla.status).toBe(SlaStatus.AT_RISK);
    expect(sla.reasons.join(' ')).toMatch(/open exception/i);
  });

  it('escalates when a human has held it for over half the window', () => {
    const sla = assessSla({
      submittedAt: submitted(70),
      targetDays: 5,
      isWaitingOnOfficer: true,
      now,
    });
    expect(sla.status).toBe(SlaStatus.AT_RISK);
    expect(sla.reasons.join(' ')).toMatch(/officer review/i);
  });

  it('stops the clock once a decision is recorded', () => {
    const sla = assessSla({
      submittedAt: submitted(200),
      decidedAt: new Date(now.getTime() - 150 * HOUR),
      targetDays: 5,
      now,
    });
    // Decided 50h after submission, comfortably inside the target.
    expect(sla.status).toBe(SlaStatus.ON_TRACK);
    expect(sla.elapsedHours).toBeCloseTo(50, 1);
  });

  it('records a breach when the decision itself came late', () => {
    const sla = assessSla({
      submittedAt: submitted(300),
      decidedAt: new Date(now.getTime() - 10 * HOUR),
      targetDays: 5,
      now,
    });
    expect(sla.status).toBe(SlaStatus.OVERDUE);
  });
});
