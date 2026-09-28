import '../setup/env.js';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { infraAvailable, login, resetDatabase, seedMinimal, skipMessage } from './helpers.js';

const available = await infraAvailable();
if (!available) skipMessage();

interface TimeSaved {
  measured: {
    departmentLookupsCompleted: number;
    fieldsPrefilled: number;
    fieldsReconciled: number;
    documentsAutoExtracted: number;
    decisionsDelivered: number;
    applicationsDecided: number;
    medianDecisionHours: number | null;
  };
  assumptions: {
    minutesPerManualLookup: number;
    secondsPerFormField: number;
    minutesPerManualCrossCheck: number;
  };
  estimate: { officerHoursSaved: number; citizenHoursSaved: number };
  caveat: string;
}

/**
 * A savings metric is trivially easy to inflate, so these tests are mostly
 * about what must NOT be counted, and about the number remaining derivable
 * from figures a sceptic can check.
 */
describe.skipIf(!available)('the time-saved estimate stays auditable', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let officerToken: string;

  beforeAll(async () => {
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    citizenToken = await login(app, seeded.citizenUser.email);
    officerToken = await login(app, seeded.officer.email);
  });

  async function report(): Promise<TimeSaved> {
    const response = await request(app)
      .get('/api/officer/time-saved')
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);
    return response.body.data as TimeSaved;
  }

  it('ships the assumptions and the caveat alongside the number', async () => {
    const data = await report();
    // An estimate nobody can interrogate is a claim, not evidence.
    expect(data.assumptions.minutesPerManualLookup).toBeGreaterThan(0);
    expect(data.assumptions.secondsPerFormField).toBeGreaterThan(0);
    expect(data.caveat).toMatch(/assumptions/i);
  });

  it('derives the citizen estimate exactly from counts and assumptions', async () => {
    const draft = await request(app)
      .post('/api/applications/draft')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP' })
      .expect(201);
    const applicationId = draft.body.data.applicationId as string;

    for (const departmentCode of ['IDENTITY', 'INCOME', 'EDUCATION']) {
      await request(app)
        .post(`/api/applications/${applicationId}/consent`)
        .set('authorization', `Bearer ${citizenToken}`)
        .send({ departmentCode, granted: true })
        .expect(200);
    }
    await request(app)
      .post(`/api/applications/${applicationId}/prefill`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(200);

    const data = await report();
    expect(data.measured.fieldsPrefilled).toBe(8);

    // No hidden fudge factor: the estimate is reproducible with a calculator.
    const expected =
      (data.measured.fieldsPrefilled * data.assumptions.secondsPerFormField) / 3600;
    expect(data.estimate.citizenHoursSaved).toBeCloseTo(Math.round(expected * 10) / 10, 5);
  });

  it('counts only the fields a department actually answered', async () => {
    // Pre-fill with no consent fills nothing. Counting those fields would be
    // the easiest way to inflate this number, so it must stay at zero.
    const draft = await request(app)
      .post('/api/applications/draft')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP' })
      .expect(201);
    await request(app)
      .post(`/api/applications/${draft.body.data.applicationId}/prefill`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(200);

    const data = await report();
    expect(data.measured.fieldsPrefilled).toBe(0);
    expect(data.estimate.citizenHoursSaved).toBe(0);
  });

  it('reports no median rather than zero when nothing has been decided', async () => {
    const data = await report();
    // Zero would read as "decided instantly", which is a claim about speed
    // rather than an absence of data.
    expect(data.measured.applicationsDecided).toBe(0);
    expect(data.measured.medianDecisionHours).toBeNull();
  });

  it('scopes the counts to the officer, and the two departments sum to the whole', async () => {
    const revenueToken = await login(app, seeded.revenueOfficer.email);
    const adminToken = await login(app, seeded.admin.email);

    const draft = await request(app)
      .post('/api/applications/draft')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'INCOME_CERTIFICATE' })
      .expect(201);
    for (const departmentCode of ['IDENTITY', 'INCOME']) {
      await request(app)
        .post(`/api/applications/${draft.body.data.applicationId}/consent`)
        .set('authorization', `Bearer ${citizenToken}`)
        .send({ departmentCode, granted: true })
        .expect(200);
    }
    await request(app)
      .post(`/api/applications/${draft.body.data.applicationId}/prefill`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(200);

    const asRevenue = await request(app)
      .get('/api/officer/time-saved')
      .set('authorization', `Bearer ${revenueToken}`)
      .expect(200);
    const asAdmin = await request(app)
      .get('/api/officer/time-saved')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const asEducation = await report();

    // The income certificate belongs to Revenue, not Education.
    expect(asRevenue.body.data.measured.fieldsPrefilled).toBe(5);
    expect(asEducation.measured.fieldsPrefilled).toBe(0);
    expect(asAdmin.body.data.measured.fieldsPrefilled).toBe(5);
  });
});

/**
 * The asymmetry is a judgement call, so it is asserted rather than left to be
 * rediscovered: an unsent draft has saved the citizen typing but has saved no
 * officer anything, because no officer has been given that work.
 */
describe.skipIf(!available)('an unsent draft counts for the citizen, never the officer', () => {
  it('credits the typing that did not happen, not work that was never created', async () => {
    await resetDatabase();
    const seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    const app = createApp();
    const citizenToken = await login(app, seeded.citizenUser.email);
    const adminToken = await login(app, seeded.admin.email);

    const draft = await request(app)
      .post('/api/applications/draft')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP' })
      .expect(201);
    for (const departmentCode of ['IDENTITY', 'INCOME', 'EDUCATION']) {
      await request(app)
        .post(`/api/applications/${draft.body.data.applicationId}/consent`)
        .set('authorization', `Bearer ${citizenToken}`)
        .send({ departmentCode, granted: true })
        .expect(200);
    }
    await request(app)
      .post(`/api/applications/${draft.body.data.applicationId}/prefill`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(200);

    const response = await request(app)
      .get('/api/officer/time-saved')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const data = response.body.data as TimeSaved;

    // The citizen really did not type these eight answers.
    expect(data.measured.fieldsPrefilled).toBe(8);
    expect(data.estimate.citizenHoursSaved).toBeGreaterThan(0);

    // But nothing has reached an officer, so no officer effort was avoided.
    expect(data.measured.departmentLookupsCompleted).toBe(0);
    expect(data.measured.applicationsDecided).toBe(0);
    expect(data.estimate.officerHoursSaved).toBe(0);
    expect(data.caveat).toMatch(/draft/i);
  });
});
