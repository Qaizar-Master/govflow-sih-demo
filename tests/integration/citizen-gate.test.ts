import '../setup/env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { infraAvailable, login, resetDatabase, seedMinimal, skipMessage } from './helpers.js';

const available = await infraAvailable();
if (!available) skipMessage();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'govflow-gate-'));
const INCOME_CERT = path.join(tmp, 'income.txt');
fs.writeFileSync(
  INCOME_CERT,
  `INCOME CERTIFICATE
Certificate No: INC/2026/44821
Applicant Name: Rohan Prajapati
Annual Income: INR 180000
Assessment Year: 2026`,
);

/**
 * Steps are driven directly rather than through BullMQ so the assertions are
 * about the engine's decisions, not about timing.
 */
describe.skipIf(!available)('a step may not complete without its basis', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let officerToken: string;
  let applicationId: string;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
    officerToken = await login(app, seeded.officer.email);
  });

  afterAll(async () => {
    const { prisma, closeQueues } = await import('@govflow/core');
    await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('refuses to complete document validation when a required document is absent', async () => {
    const { prisma, runStep } = await import('@govflow/core');

    const created = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP', consents: ['IDENTITY', 'INCOME', 'EDUCATION'] })
      .expect(201);
    applicationId = created.body.data.applicationId;

    for (const stepType of [
      'CONSENT',
      'IDENTITY_VERIFICATION',
      'INCOME_VERIFICATION',
      'EDUCATION_VERIFICATION',
      'LEGACY_CROSS_CHECK',
    ]) {
      await runStep({ applicationId, stepType: stepType as never, attempt: 1, maxAttempts: 3 });
    }

    const outcome = await runStep({
      applicationId,
      stepType: 'DOCUMENT_VALIDATION' as never,
      attempt: 1,
      maxAttempts: 3,
    });

    // The scholarship requires two certificates; none were uploaded.
    expect(outcome.result).toBe('WAITING_FOR_CITIZEN');

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { stepType: 'DOCUMENT_VALIDATION', workflowInstance: { applicationId } },
    });
    expect(step.status).toBe('PENDING');
    expect(step.completedAt).toBeNull();
    expect(step.errorMessage).toMatch(/income certificate/i);
  });

  it('parks the application on the citizen, not the officer', async () => {
    const { prisma } = await import('@govflow/core');
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(application.status).toBe('AWAITING_CITIZEN_ACTION');
    expect(application.status).not.toBe('REQUIRES_REVIEW');
  });

  it('keeps a citizen-blocked application out of the officer queue', async () => {
    const response = await request(app)
      .get('/api/officer/applications')
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);

    const numbers = response.body.data.items.map(
      (a: { id: string }) => a.id,
    );
    expect(numbers).not.toContain(applicationId);
  });

  it('still counts it for the officer, so nothing is invisible', async () => {
    const response = await request(app)
      .get('/api/officer/metrics')
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);
    expect(response.body.data.awaitingCitizen).toBeGreaterThanOrEqual(1);
  });

  it('tells the citizen exactly which document is needed', async () => {
    const { prisma } = await import('@govflow/core');
    const notification = await prisma.notification.findFirst({
      where: { userId: seeded.citizenUser.id, title: 'Document required' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification?.message).toMatch(/income certificate/i);
  });

  it('releases the gate once the document is supplied', async () => {
    const { prisma, runStep } = await import('@govflow/core');

    await request(app)
      .post(`/api/applications/${applicationId}/documents`)
      .set('authorization', `Bearer ${citizenToken}`)
      .field('documentType', 'INCOME_CERTIFICATE')
      .attach('file', INCOME_CERT, { contentType: 'text/plain' })
      .expect(201);
    await request(app)
      .post(`/api/applications/${applicationId}/documents`)
      .set('authorization', `Bearer ${citizenToken}`)
      .field('documentType', 'EDUCATION_CERTIFICATE')
      .attach('file', INCOME_CERT, { contentType: 'text/plain' })
      .expect(201);

    const outcome = await runStep({
      applicationId,
      stepType: 'DOCUMENT_VALIDATION' as never,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(outcome.result).toBe('COMPLETED');

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { stepType: 'DOCUMENT_VALIDATION', workflowInstance: { applicationId } },
    });
    expect(step.status).toBe('COMPLETED');
  });

  it('flags the wrong-type upload for the officer without blocking it', async () => {
    const { prisma } = await import('@govflow/core');
    // The education slot was deliberately filled with the income certificate.
    const document = await prisma.document.findFirstOrThrow({
      where: { applicationId, documentType: 'EDUCATION_CERTIFICATE' },
    });
    const extracted = document.extractedData as {
      typeCheck?: { matches: boolean; looksLike: string | null };
    };
    expect(extracted.typeCheck?.matches).toBe(false);
    expect(extracted.typeCheck?.looksLike).toBe('INCOME_CERTIFICATE');
    // Advisory: the document is still stored and the step still completed.
    expect(document.extractionStatus).toBe('COMPLETED');
    expect(document.validationStatus).toBe('WARNING');
  });
});

describe.skipIf(!available)('services with no document requirement are unaffected', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
  });

  afterAll(async () => {
    const { prisma, closeQueues } = await import('@govflow/core');
    await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
  });

  it('completes document validation for an income certificate application', async () => {
    const { runStep } = await import('@govflow/core');
    const created = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'INCOME_CERTIFICATE', consents: ['IDENTITY', 'INCOME'] })
      .expect(201);
    const applicationId = created.body.data.applicationId;

    for (const stepType of ['CONSENT', 'IDENTITY_VERIFICATION', 'INCOME_VERIFICATION']) {
      await runStep({ applicationId, stepType: stepType as never, attempt: 1, maxAttempts: 3 });
    }

    // requiredDocuments is empty for an issuance, so the gate must not fire.
    const outcome = await runStep({
      applicationId,
      stepType: 'DOCUMENT_VALIDATION' as never,
      attempt: 1,
      maxAttempts: 3,
    });
    expect(outcome.result).toBe('COMPLETED');
  });
});
