import '../setup/env.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'govflow-docs-'));

function writeCertificate(name: string, content: string): string {
  const file = path.join(tmpDir, name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

const INCOME_CERT = writeCertificate(
  'income.txt',
  `INCOME CERTIFICATE (SYNTHETIC SPECIMEN)
Certificate No: INC/2026/44821
Applicant Name: Rohan Prajapati
District: Pune
Annual Income: INR 180000
Date of Issue: 14/04/2026
`,
);

const EDUCATION_CERT = writeCertificate(
  'education.txt',
  `BONAFIDE CERTIFICATE (SYNTHETIC SPECIMEN)
Certificate No: EDU/2026/9101
Student Name: Rohan P.
Institution: Sinhgad Institute of Technology
Course: B.E. Computer Engineering
Date of Issue: 02/04/2026
`,
);

describe.skipIf(!available)('scholarship workflow, end to end', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let officerToken: string;
  let worker: Worker;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');

    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
    officerToken = await login(app, seeded.officer.email);

    // A real BullMQ worker, so retries and backoff are genuinely exercised.
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
    await setMockFailure('INCOME', 'OFF');
    await worker?.close();
    const { prisma, closeQueues } = await import('@govflow/core');
    await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  let applicationId: string;

  it('accepts the application immediately without calling any department', async () => {
    const started = Date.now();
    const response = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ requestedAmount: 50000, consents: [] })
      .expect(201);

    applicationId = response.body.data.applicationId;
    expect(response.body.data.status).toBe('PROCESSING');
    expect(response.body.data.outstandingConsents).toBe(3);
    expect(response.body.data.applicationNumber).toMatch(/^GF-SCH-\d{4}-\d{5}$/);
    // The HTTP call must not block on four departmental lookups.
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('materialises the full workflow definition up front', async () => {
    const { prisma } = await import('@govflow/core');
    const workflow = await prisma.workflowInstance.findUniqueOrThrow({
      where: { applicationId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    // Nine steps up to the decision, plus delivering that decision back.
    expect(workflow.steps).toHaveLength(10);
    expect(workflow.steps.map((s) => s.stepType)).toEqual([
      'CONSENT',
      'IDENTITY_VERIFICATION',
      'INCOME_VERIFICATION',
      'EDUCATION_VERIFICATION',
      'LEGACY_CROSS_CHECK',
      'DOCUMENT_VALIDATION',
      'DATA_QUALITY_CHECK',
      'OFFICER_REVIEW',
      'FINAL_DECISION',
      'DEPARTMENT_WRITE_BACK',
    ]);
  });

  it('parks at the consent gate and contacts nobody until consent is granted', async () => {
    const { prisma } = await import('@govflow/core');
    const workflow = await waitFor(
      () => prisma.workflowInstance.findUniqueOrThrow({ where: { applicationId } }),
      (w) => w.status === 'SUSPENDED',
    );
    expect(workflow.currentStep).toBe('CONSENT');

    // The consent gate must hold before a single department is queried.
    const records = await prisma.normalizedRecord.count({ where: { applicationId } });
    const calls = await prisma.connectorLog.count({ where: { applicationId } });
    expect(records).toBe(0);
    expect(calls).toBe(0);
  });

  it('runs every department lookup once the last consent is granted', async () => {
    for (const departmentCode of ['IDENTITY', 'INCOME', 'EDUCATION']) {
      await request(app)
        .post(`/api/applications/${applicationId}/consent`)
        .set('authorization', `Bearer ${citizenToken}`)
        .send({ departmentCode, granted: true })
        .expect(200);
    }

    const { prisma } = await import('@govflow/core');
    // All four departments run, then the workflow stops at the document gate -
    // the scholarship requires certificates that have not been uploaded yet.
    await waitFor(
      () => prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
      (a) => a.status === 'AWAITING_CITIZEN_ACTION',
      25_000,
    );

    const records = await prisma.normalizedRecord.findMany({ where: { applicationId } });
    expect(records.map((r) => r.dataType).sort()).toEqual([
      'EDUCATION',
      'IDENTITY',
      'INCOME',
      'LEGACY_BENEFICIARY',
    ]);
  });

  it('does not hand an incomplete application to an officer', async () => {
    const { prisma } = await import('@govflow/core');
    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(application.currentStep).toBe('DOCUMENT_VALIDATION');
    expect(application.status).not.toBe('REQUIRES_REVIEW');
    expect(application.status).not.toBe('UNDER_REVIEW');
  });

  it('normalises four different department schemas into the common data model', async () => {
    const response = await request(app)
      .get(`/api/officer/applications/${applicationId}`)
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);

    const { verification } = response.body.data;
    // Each source keeps its own identifier keyspace...
    expect(verification.identity.citizenId).toBe('CIT-1001');
    expect(verification.income.citizenId).toBe('INC-1001');
    expect(verification.education.citizenId).toBe('STU-1001');
    // ...but every one speaks the same field vocabulary.
    expect(verification.income.annualIncome).toBe(180000);
    expect(verification.education.educationStatus).toBe('ACTIVE');
    expect(verification.legacy.verificationStatus).toBe('VERIFIED');
    // And the consolidated record records where each field came from.
    expect(verification.consolidated.provenance.annualIncome).toBe('INCOME_DEPARTMENT');
    expect(verification.consolidated.provenance.institution).toBe('EDUCATION_DEPARTMENT');
  });

  it('records an auditable trail of every department the data came from', async () => {
    const { prisma } = await import('@govflow/core');
    const accessed = await prisma.auditLog.findMany({
      where: { action: 'DATA_ACCESSED' },
    });
    expect(accessed.length).toBeGreaterThanOrEqual(4);

    const consentGranted = await prisma.auditLog.count({
      where: { action: 'CONSENT_GRANTED' },
    });
    expect(consentGranted).toBeGreaterThanOrEqual(3);
  });

  it('extracts fields from an uploaded certificate and releases the gate', async () => {
    const upload = await request(app)
      .post(`/api/applications/${applicationId}/documents`)
      .set('authorization', `Bearer ${citizenToken}`)
      .field('documentType', 'INCOME_CERTIFICATE')
      .attach('file', INCOME_CERT, { contentType: 'text/plain' })
      .expect(201);

    expect(upload.body.data.extraction.fields.name).toBe('Rohan Prajapati');
    expect(upload.body.data.extraction.fields.annualIncome).toBe(180000);
    expect(upload.body.data.extraction.ocrEngine).toBe('TEXT_LAYER');

    await request(app)
      .post(`/api/applications/${applicationId}/documents`)
      .set('authorization', `Bearer ${citizenToken}`)
      .field('documentType', 'EDUCATION_CERTIFICATE')
      .attach('file', EDUCATION_CERT, { contentType: 'text/plain' })
      .expect(201);

    const { prisma, resumeWorkflow } = await import('@govflow/core');
    // Both required certificates are now present, so the gate releases.
    await resumeWorkflow(applicationId);

    const application = await waitFor(
      () => prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
      (a) => a.validationSummary !== null && a.status !== 'AWAITING_CITIZEN_ACTION',
      25_000,
    );

    const report = application.validationSummary as {
      status: string;
      engine: string;
      advisoryOnly: boolean;
      findings: { kind: string }[];
    };
    expect(report.advisoryOnly).toBe(true);
    // No Gemini key in CI, so the deterministic engine must have carried it.
    expect(report.engine).toBe('RULE_BASED');
    // No missing-document findings remain; the genuine name mismatch does.
    expect(report.findings.some((f) => f.kind === 'MISSING_DOCUMENT')).toBe(false);
    expect(report.findings.some((f) => f.kind === 'NAME_MISMATCH')).toBe(true);
  });

  it('rejects an unsupported file type', async () => {
    const badFile = writeCertificate('malicious.exe', 'MZ');
    await request(app)
      .post(`/api/applications/${applicationId}/documents`)
      .set('authorization', `Bearer ${citizenToken}`)
      .field('documentType', 'OTHER')
      .attach('file', badFile, { contentType: 'application/x-msdownload' })
      .expect(400);
  });

  it('hands the application to an officer rather than deciding it', async () => {
    const { prisma } = await import('@govflow/core');
    const application = await waitFor(
      () => prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
      (a) => a.status === 'UNDER_REVIEW' || a.status === 'REQUIRES_REVIEW',
      25_000,
    );
    expect(application.currentStep).toBe('OFFICER_REVIEW');
    // Nothing automated may reach a terminal state.
    expect(['APPROVED', 'REJECTED']).not.toContain(application.status);
  });

  it('requires a justification before an officer can decide', async () => {
    await request(app)
      .post(`/api/officer/applications/${applicationId}/approve`)
      .set('authorization', `Bearer ${officerToken}`)
      .send({ notes: 'ok' })
      .expect(400);
  });

  it('records the officer approval and shows it to the citizen', async () => {
    const approval = await request(app)
      .post(`/api/officer/applications/${applicationId}/approve`)
      .set('authorization', `Bearer ${officerToken}`)
      .send({
        notes: 'Name abbreviation confirmed with the institution. Income within the ceiling.',
      })
      .expect(200);
    expect(approval.body.data.status).toBe('APPROVED');

    const citizenView = await request(app)
      .get(`/api/applications/${applicationId}`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(200);

    // Citizen and officer read the same underlying state.
    expect(citizenView.body.data.application.status).toBe('APPROVED');
    expect(citizenView.body.data.application.decidedBy.name).toBe('Sunita Deshpande');
    // The human decision is final the moment the officer makes it. Delivering
    // it to the department is a separate step that may still be in flight, and
    // that is deliberate: an outage there must not read as an undecided file.
    const decisionStep = citizenView.body.data.timeline.find(
      (t: { stepType: string }) => t.stepType === 'FINAL_DECISION',
    );
    expect(decisionStep.status).toBe('COMPLETED');
    // Internal officer notes stay internal.
    expect(citizenView.body.data.reviewNotes).toEqual([]);

    const { prisma } = await import('@govflow/core');
    const audit = await prisma.auditLog.findFirst({ where: { action: 'OFFICER_APPROVED' } });
    expect(audit).not.toBeNull();

    const notification = await prisma.notification.findFirst({
      where: { userId: seeded.citizenUser.id, title: { contains: 'approved' } },
    });
    expect(notification).not.toBeNull();
  });

  it('refuses to decide the same application twice', async () => {
    const response = await request(app)
      .post(`/api/officer/applications/${applicationId}/reject`)
      .set('authorization', `Bearer ${officerToken}`)
      .send({ notes: 'Attempting to overturn an already-final decision.' })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT');
  });
});

describe.skipIf(!available)('departmental outage: retry, exception, recovery', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let applicationId: string;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
  });

  afterAll(async () => {
    await setMockFailure('INCOME', 'OFF');
    const { prisma, closeQueues } = await import('@govflow/core');
    await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
  });

  it('retries a failing department and raises an exception once attempts are exhausted', async () => {
    const { runStep } = await import('@govflow/core');
    const { prisma } = await import('@govflow/core');

    const created = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ consents: ['IDENTITY', 'INCOME', 'EDUCATION'] })
      .expect(201);
    applicationId = created.body.data.applicationId;

    // Steps are driven directly here so the attempt counter is deterministic.
    await runStep({ applicationId, stepType: 'CONSENT', attempt: 1, maxAttempts: 3 });
    await runStep({
      applicationId,
      stepType: 'IDENTITY_VERIFICATION',
      attempt: 1,
      maxAttempts: 3,
    });

    await setMockFailure('INCOME', 'ERROR_500');

    const first = await runStep({
      applicationId,
      stepType: 'INCOME_VERIFICATION',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(first.result).toBe('RETRY');

    const second = await runStep({
      applicationId,
      stepType: 'INCOME_VERIFICATION',
      attempt: 2,
      maxAttempts: 3,
    });
    expect(second.result).toBe('RETRY');

    const third = await runStep({
      applicationId,
      stepType: 'INCOME_VERIFICATION',
      attempt: 3,
      maxAttempts: 3,
    });
    expect(third.result).toBe('EXHAUSTED');

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { stepType: 'INCOME_VERIFICATION', workflowInstance: { applicationId } },
    });
    expect(step.status).toBe('REQUIRES_REVIEW');
    expect(step.retryCount).toBe(3);

    const exception = await prisma.exception.findFirstOrThrow({
      where: { applicationId, type: 'CONNECTOR_FAILURE' },
    });
    expect(exception.severity).toBe('HIGH');
    expect(exception.retryCount).toBe(3);
    expect(exception.status).toBe('OPEN');

    // Three real HTTP attempts were made and logged.
    const failures = await prisma.connectorLog.count({
      where: { applicationId, connector: 'INCOME', requestStatus: 'FAILURE' },
    });
    expect(failures).toBe(3);

    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(application.status).toBe('REQUIRES_REVIEW');
  });

  it('tells the citizen why the application is delayed', async () => {
    const { prisma } = await import('@govflow/core');
    const notification = await prisma.notification.findFirst({
      where: { userId: seeded.citizenUser.id, type: 'WARNING' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification?.message).toMatch(/Income.*unavailable/i);
  });

  it('resumes from the failed step once the department is restored', async () => {
    const { prisma, resumeWorkflow, runStep } = await import('@govflow/core');

    await setMockFailure('INCOME', 'OFF');
    const resumed = await resumeWorkflow(applicationId, { userId: seeded.admin.id });
    expect(resumed.resumedStep).toBe('INCOME_VERIFICATION');

    const outcome = await runStep({
      applicationId,
      stepType: 'INCOME_VERIFICATION',
      attempt: 1,
      maxAttempts: 3,
    });
    expect(outcome.result).toBe('COMPLETED');

    const step = await prisma.workflowStep.findFirstOrThrow({
      where: { stepType: 'INCOME_VERIFICATION', workflowInstance: { applicationId } },
    });
    expect(step.status).toBe('COMPLETED');

    const record = await prisma.normalizedRecord.findFirstOrThrow({
      where: { applicationId, dataType: 'INCOME' },
    });
    expect((record.normalizedPayload as { annualIncome: number }).annualIncome).toBe(180000);
  });

  it('keeps a non-blocking department from stopping the workflow', async () => {
    const { prisma, runStep } = await import('@govflow/core');
    await runStep({
      applicationId,
      stepType: 'EDUCATION_VERIFICATION',
      attempt: 1,
      maxAttempts: 3,
    });

    // Point the legacy connector at a missing export by flagging an outage.
    await prisma.department.update({
      where: { code: 'LEGACY' },
      data: { simulatedFailureMode: 'UNAVAILABLE' },
    });

    const outcome = await runStep({
      applicationId,
      stepType: 'LEGACY_CROSS_CHECK',
      attempt: 3,
      maxAttempts: 3,
    });

    // Non-blocking: the failure is recorded but the chain continues.
    expect(outcome.result).toBe('COMPLETED');
    const exception = await prisma.exception.findFirst({
      where: { applicationId, message: { contains: 'Legacy' } },
      orderBy: { createdAt: 'desc' },
    });
    expect(exception?.severity).toBe('LOW');

    await prisma.department.update({
      where: { code: 'LEGACY' },
      data: { simulatedFailureMode: null },
    });
  });
});
