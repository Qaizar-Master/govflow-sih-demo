import '../setup/env.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Worker } from 'bullmq';
import type { Express } from 'express';
import {
  infraAvailable,
  login,
  resetDatabase,
  seedMinimal,
  setMockFailure,
  skipMessage,
  waitFor,
} from './helpers.js';

const available = await infraAvailable();
if (!available) skipMessage();

const FULL_FORM = {
  fullName: 'Rohan Prajapati',
  dateOfBirth: '2003-05-12',
  district: 'Pune',
  annualIncome: 180000,
  incomeYear: 2026,
  institution: 'Sinhgad Institute of Technology',
  course: 'B.E. Computer Engineering',
  educationStatus: 'ACTIVE',
  requestedAmount: 50000,
};

describe.skipIf(!available)('pre-fill answers the form from the registries', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;

  beforeEach(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
  });

  async function openDraft(serviceType = 'SCHOLARSHIP'): Promise<string> {
    const response = await request(app)
      .post('/api/applications/draft')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType })
      .expect(201);
    return response.body.data.applicationId as string;
  }

  async function grantAll(applicationId: string): Promise<void> {
    for (const departmentCode of ['IDENTITY', 'INCOME', 'EDUCATION']) {
      await request(app)
        .post(`/api/applications/${applicationId}/consent`)
        .set('authorization', `Bearer ${citizenToken}`)
        .send({ departmentCode, granted: true })
        .expect(200);
    }
  }

  async function prefill(applicationId: string) {
    const response = await request(app)
      .post(`/api/applications/${applicationId}/prefill`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(200);
    return response.body.data as {
      fields: { key: string; status: string; value: unknown; source: { departmentCode: string } | null; note?: string }[];
      filledCount: number;
      totalPrefillable: number;
      unavailable: { departmentCode: string }[];
    };
  }

  it('opens an inert draft: consents pending, no workflow, no officer visibility', async () => {
    const applicationId = await openDraft();
    const { prisma } = await import('@govflow/core');

    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { consents: true, workflow: true },
    });
    expect(application.status).toBe('DRAFT');
    expect(application.workflow).toBeNull();
    expect(application.consents.every((c) => c.status === 'PENDING')).toBe(true);

    // A draft is not a queue item: nothing has been claimed yet.
    const officerToken = await login(app, seeded.officer.email);
    const queue = await request(app)
      .get('/api/officer/applications?pageSize=50')
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);
    expect(queue.body.data.items.map((i: { id: string }) => i.id)).not.toContain(applicationId);
  });

  it('contacts nobody without consent, and says why the form is empty', async () => {
    const applicationId = await openDraft();
    const result = await prefill(applicationId);

    expect(result.filledCount).toBe(0);
    expect(result.fields.every((f) => f.status === 'CONSENT_REQUIRED')).toBe(true);
    // A blank box with no explanation reads as "the registry holds nothing".
    expect(result.fields.every((f) => typeof f.note === 'string')).toBe(true);

    const { prisma } = await import('@govflow/core');
    expect(await prisma.connectorLog.count({ where: { applicationId } })).toBe(0);
  });

  it('answers every field once consent is granted, attributing each to a department', async () => {
    const applicationId = await openDraft();
    await grantAll(applicationId);
    const result = await prefill(applicationId);

    expect(result.filledCount).toBe(result.totalPrefillable);
    const byKey = Object.fromEntries(result.fields.map((f) => [f.key, f]));

    expect(byKey.fullName).toMatchObject({ value: 'Rohan Prajapati', status: 'FILLED' });
    expect(byKey.fullName!.source!.departmentCode).toBe('IDENTITY');
    expect(byKey.annualIncome).toMatchObject({ value: 180000 });
    expect(byKey.annualIncome!.source!.departmentCode).toBe('INCOME');
    expect(byKey.institution!.source!.departmentCode).toBe('EDUCATION');
  });

  it('records the snapshot, and replaces it rather than appending on a second run', async () => {
    const applicationId = await openDraft();
    await grantAll(applicationId);
    await prefill(applicationId);
    await prefill(applicationId);

    const { prisma } = await import('@govflow/core');
    expect(await prisma.prefillSnapshot.count({ where: { applicationId } })).toBe(1);
  });

  it('degrades to a fillable box when a department is down, and says so', async () => {
    const applicationId = await openDraft();
    await grantAll(applicationId);
    await setMockFailure('INCOME', 'ERROR_500');

    try {
      const result = await prefill(applicationId);
      const income = result.fields.find((f) => f.key === 'annualIncome')!;

      expect(income.status).toBe('UNAVAILABLE');
      expect(income.value).toBeNull();
      // The citizen must know the box is theirs to fill, not that the
      // department said nothing.
      expect(income.note).toMatch(/could not be reached/i);
      expect(result.unavailable.map((u) => u.departmentCode)).toContain('INCOME');

      // Identity was still reachable, so pre-fill is partial, not abandoned.
      expect(result.fields.find((f) => f.key === 'fullName')!.status).toBe('FILLED');
    } finally {
      await setMockFailure('INCOME', 'OFF');
    }
  });

  it('refuses to pre-fill an application that has already been submitted', async () => {
    const applicationId = await openDraft();
    await grantAll(applicationId);
    await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values: FULL_FORM })
      .expect(200);

    await request(app)
      .post(`/api/applications/${applicationId}/prefill`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(409);
  });
});

describe.skipIf(!available)('submitting a draft', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;

  beforeEach(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
  });

  async function openDraft(): Promise<string> {
    const response = await request(app)
      .post('/api/applications/draft')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP' })
      .expect(201);
    return response.body.data.applicationId as string;
  }

  it('names the fields that are missing rather than failing generically', async () => {
    const applicationId = await openDraft();
    const response = await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values: { fullName: 'Rohan Prajapati' } })
      .expect(400);

    const details = response.body.error.details as Record<string, string>;
    expect(Object.keys(details)).toEqual(
      expect.arrayContaining(['dateOfBirth', 'annualIncome', 'requestedAmount']),
    );
    // `course` is optional on this form and must not be demanded.
    expect(details.course).toBeUndefined();
  });

  it('rejects a non-numeric answer in a numeric field', async () => {
    const applicationId = await openDraft();
    const response = await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values: { ...FULL_FORM, annualIncome: 'a lot' } })
      .expect(400);
    expect(response.body.error.details.annualIncome).toMatch(/must be a number/i);
  });

  it('stores what was submitted and releases the workflow', async () => {
    const applicationId = await openDraft();
    await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values: FULL_FORM })
      .expect(200);

    const { prisma } = await import('@govflow/core');
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: { workflow: true },
    });
    expect(application.status).not.toBe('DRAFT');
    expect(application.workflow).not.toBeNull();
    expect((application.submittedValues as Record<string, unknown>).annualIncome).toBe(180000);
    // Kept in step for the validation engine and the officer list.
    expect(application.requestedAmount).toBe(50000);
  });

  it('will not submit the same draft twice', async () => {
    const applicationId = await openDraft();
    await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values: FULL_FORM })
      .expect(200);

    await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values: FULL_FORM })
      .expect(409);
  });
});

/**
 * The reconciliation is the reason pre-fill is evidence rather than a
 * convenience, so the distinctions it draws are asserted individually.
 */
describe.skipIf(!available)('reconciling what was shown, sent and verified', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let officerToken: string;
  let worker: Worker;

  beforeAll(async () => {
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();

    // Reconciliation compares against what the workflow actually fetched, so
    // the workflow has to genuinely run. A real worker on the test queue
    // namespace does that; nothing else consumes it.
    const { QUEUE_NAMES, workflowConfig } = await import('@govflow/contracts');
    const { redisConnection, runStep } = await import('@govflow/core');
    worker = new Worker(
      QUEUE_NAMES.WORKFLOW,
      async (job) => {
        const outcome = await runStep({
          applicationId: job.data.applicationId,
          stepType: job.data.stepType,
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts ?? workflowConfig.maxAttempts,
        });
        if (outcome.result === 'RETRY') throw outcome.error;
        return outcome;
      },
      { connection: redisConnection, prefix: 'govflow-test', concurrency: 2 },
    );
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await worker?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    citizenToken = await login(app, seeded.citizenUser.email);
    officerToken = await login(app, seeded.officer.email);
  });

  /** Opens a draft, pre-fills it, submits `values`, and waits for verification. */
  async function runApplication(values: Record<string, unknown>): Promise<string> {
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
    await request(app)
      .post(`/api/applications/${applicationId}/submit`)
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ values })
      .expect(200);

    const { prisma } = await import('@govflow/core');
    // Wait until the income lookup has actually run, so `verified` is real.
    await waitFor(
      () => prisma.normalizedRecord.count({ where: { applicationId, dataType: 'INCOME' } }),
      (count) => count > 0,
    );
    return applicationId;
  }

  async function reconciliationFor(applicationId: string) {
    const response = await request(app)
      .get(`/api/officer/applications/${applicationId}`)
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);
    return response.body.data.reconciliation as {
      available: boolean;
      attentionCount: number;
      matchedCount: number;
      rows: { key: string; verdict: string; prefilled: unknown; submitted: unknown; verified: unknown }[];
    };
  }

  it('reports a match when nothing was re-keyed', async () => {
    const applicationId = await runApplication(FULL_FORM);
    const report = await reconciliationFor(applicationId);

    expect(report.available).toBe(true);
    expect(report.attentionCount).toBe(0);
    const income = report.rows.find((r) => r.key === 'annualIncome')!;
    expect(income.verdict).toBe('MATCH');
  });

  it('flags a value the citizen changed while the registry stood still', async () => {
    const applicationId = await runApplication({ ...FULL_FORM, annualIncome: 98000 });
    const report = await reconciliationFor(applicationId);

    const income = report.rows.find((r) => r.key === 'annualIncome')!;
    expect(income.verdict).toBe('CITIZEN_EDITED');
    expect(income.prefilled).toBe(180000);
    expect(income.submitted).toBe(98000);
    expect(income.verified).toBe(180000);
    expect(report.attentionCount).toBe(1);

    // Everything untouched still reads as clean, so the one edit stands out.
    expect(report.rows.find((r) => r.key === 'district')!.verdict).toBe('MATCH');
  });

  /**
   * The distinction that matters. Same surface symptom - submitted value does
   * not equal the registry - but the applicant did nothing wrong, and an
   * officer must not be left to guess which case they are looking at.
   */
  it('separates a registry that moved from a citizen who edited', async () => {
    const { prisma } = await import('@govflow/core');
    const applicationId = await runApplication(FULL_FORM);

    // Rewrite the snapshot so it holds what the citizen was shown *before* the
    // registry changed: they submitted that figure faithfully.
    const snapshot = await prisma.prefillSnapshot.findUniqueOrThrow({ where: { applicationId } });
    const fields = (snapshot.fields as unknown as { key: string; value: unknown }[]).map((f) =>
      f.key === 'annualIncome' ? { ...f, value: 180000 } : f,
    );
    await prisma.prefillSnapshot.update({ where: { applicationId }, data: { fields: fields as never } });
    await prisma.application.update({
      where: { id: applicationId },
      data: { submittedValues: { ...FULL_FORM, annualIncome: 180000 } as never },
    });
    // ...and move the verified record, as a fresh assessment would.
    const record = await prisma.normalizedRecord.findFirstOrThrow({
      where: { applicationId, dataType: 'INCOME' },
    });
    await prisma.normalizedRecord.update({
      where: { id: record.id },
      data: {
        normalizedPayload: {
          ...(record.normalizedPayload as Record<string, unknown>),
          annualIncome: 210000,
        } as never,
      },
    });

    const income = (await reconciliationFor(applicationId)).rows.find(
      (r) => r.key === 'annualIncome',
    )!;
    expect(income.verdict).toBe('REGISTRY_CHANGED');
  });

  it('does not compare a field no department holds', async () => {
    const applicationId = await runApplication(FULL_FORM);
    const report = await reconciliationFor(applicationId);
    expect(report.rows.find((r) => r.key === 'requestedAmount')!.verdict).toBe('CITIZEN_DECLARED');
  });

  it('does not treat a numeric string as a mismatch', async () => {
    // The form posts strings; the registry returns numbers. Reporting that as
    // a divergence would be a bug dressed up as a finding.
    const applicationId = await runApplication({ ...FULL_FORM, annualIncome: '180000' });
    const income = (await reconciliationFor(applicationId)).rows.find(
      (r) => r.key === 'annualIncome',
    )!;
    expect(income.verdict).toBe('MATCH');
  });

  /**
   * A field the workflow has not reached yet is not a disagreement. Reporting
   * it as one would manufacture findings out of a step that simply has not
   * happened, which is how an officer learns to ignore the panel.
   */
  it('does not call an unverified field divergent', async () => {
    const { prisma } = await import('@govflow/core');
    const applicationId = await runApplication(FULL_FORM);

    // Drop the verification evidence, as if the department had not answered.
    await prisma.normalizedRecord.deleteMany({ where: { applicationId } });

    const report = await reconciliationFor(applicationId);
    const income = report.rows.find((r) => r.key === 'annualIncome')!;
    expect(income.verdict).toBe('AWAITING_VERIFICATION');
    expect(report.attentionCount).toBe(0);
  });

  it('still flags an edit made before verification has run', async () => {
    const { prisma } = await import('@govflow/core');
    const applicationId = await runApplication({ ...FULL_FORM, annualIncome: 98000 });
    await prisma.normalizedRecord.deleteMany({ where: { applicationId } });

    const income = (await reconciliationFor(applicationId)).rows.find(
      (r) => r.key === 'annualIncome',
    )!;
    // Shown-versus-submitted is knowable without the department.
    expect(income.verdict).toBe('CITIZEN_EDITED');
  });

  it('reports unavailable rather than clean for an application that predates pre-fill', async () => {
    // An empty table reads as "nothing diverged", which is a different and
    // much stronger claim than "nothing was checked".
    const response = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP', requestedAmount: 50000, consents: [] })
      .expect(201);

    const report = await reconciliationFor(response.body.data.applicationId as string);
    expect(report.available).toBe(false);
    expect(report.rows).toHaveLength(0);
  });
});
