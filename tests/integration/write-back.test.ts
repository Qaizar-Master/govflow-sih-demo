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

/**
 * Write-back is the only place GovFlow causes an effect in another system, so
 * these tests care less about the happy path than about what happens when it
 * goes wrong: a retry after a timeout, a department with no inbox, and a
 * decision that is recorded but not yet delivered.
 */
describe.skipIf(!available)('handing the decision back to the department', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let officerToken: string;
  let worker: Worker;

  beforeAll(async () => {
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();

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
    await setMockFailure('EDUCATION', 'OFF');
    await worker?.close();
  });

  beforeEach(async () => {
    await resetDatabase();
    // The department's memory outlives a GovFlow reset, which is realistic but
    // makes application numbers collide between tests. Clear it explicitly.
    await fetch('http://localhost:5001/api/__decisions', { method: 'DELETE' });
    seeded = await seedMinimal('CIT-1001');
    citizenToken = await login(app, seeded.citizenUser.email);
    officerToken = await login(app, seeded.officer.email);
  });

  /** Submits, waits for the officer gate, and returns the application id. */
  async function applicationAwaitingDecision(): Promise<string> {
    const created = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({
        serviceType: 'SCHOLARSHIP',
        requestedAmount: 50000,
        consents: ['IDENTITY', 'INCOME', 'EDUCATION'],
      })
      .expect(201);
    const applicationId = created.body.data.applicationId as string;

    const { prisma } = await import('@govflow/core');
    await waitFor(
      () => prisma.application.findUniqueOrThrow({ where: { id: applicationId } }),
      (a) => a.status === 'REQUIRES_REVIEW' || a.status === 'AWAITING_CITIZEN_ACTION',
      25_000,
    );
    return applicationId;
  }

  async function approve(applicationId: string): Promise<void> {
    await request(app)
      .post(`/api/officer/applications/${applicationId}/approve`)
      .set('authorization', `Bearer ${officerToken}`)
      .send({ notes: 'Every registry agrees. Sanctioned.' })
      .expect(200);
  }

  async function acknowledgementFor(applicationId: string) {
    const { prisma } = await import('@govflow/core');
    return waitFor(
      () =>
        prisma.departmentAcknowledgement.findFirst({
          where: { applicationId, departmentCode: 'EDUCATION' },
        }),
      (row) => row !== null && row.status !== 'PENDING',
      25_000,
    );
  }

  it("delivers the decision and stores the department's own reference", async () => {
    const applicationId = await applicationAwaitingDecision();
    await approve(applicationId);

    const ack = (await acknowledgementFor(applicationId))!;
    expect(ack.status).toBe('DELIVERED');
    // Their format, not ours. GovFlow's number correlates; this one certifies.
    expect(ack.departmentReference).toMatch(/^EDU\/SCH\/\d{4}\/\d{5}$/);
    expect(ack.deliveredAt).not.toBeNull();
  });

  it('sends the department its own identifier for the citizen, not ours', async () => {
    const applicationId = await applicationAwaitingDecision();
    await approve(applicationId);
    const ack = (await acknowledgementFor(applicationId))!;

    const payload = ack.requestPayload as Record<string, unknown>;
    // The crosswalk earns its keep here as much as on the way in.
    expect(payload.citizenIdentifier).toBe('STU-1001');
    expect(payload.govflowReference).toMatch(/^GF-SCH-/);
  });

  it('identifies the officer by an opaque reference rather than a name', async () => {
    const applicationId = await applicationAwaitingDecision();
    await approve(applicationId);
    const ack = (await acknowledgementFor(applicationId))!;

    const payload = ack.requestPayload as Record<string, string>;
    // The department needs to know a competent officer decided. It does not
    // need an individual's identity in its own records.
    expect(payload.officerReference).toMatch(/^GF-OFF-/);
    expect(JSON.stringify(payload)).not.toContain(seeded.officer.name);
    expect(JSON.stringify(payload)).not.toContain(seeded.officer.email);
  });

  it('keeps the decision standing when the department cannot be reached', async () => {
    const applicationId = await applicationAwaitingDecision();
    await setMockFailure('EDUCATION', 'ERROR_500');

    try {
      await approve(applicationId);
      const ack = (await acknowledgementFor(applicationId))!;

      expect(ack.status).toBe('FAILED');
      expect(ack.departmentReference).toBeNull();
      expect(ack.lastError).toBeTruthy();

      // The crucial part: the applicant is still approved. A delivery outage
      // must never read as an undecided application.
      const { prisma } = await import('@govflow/core');
      const application = await prisma.application.findUniqueOrThrow({
        where: { id: applicationId },
      });
      expect(application.status).toBe('APPROVED');
      expect(application.decisionAt).not.toBeNull();
    } finally {
      await setMockFailure('EDUCATION', 'OFF');
    }
  });

  it('raises an exception an officer can see when delivery is exhausted', async () => {
    const applicationId = await applicationAwaitingDecision();
    await setMockFailure('EDUCATION', 'ERROR_500');

    try {
      await approve(applicationId);
      const { prisma } = await import('@govflow/core');
      const exception = await waitFor(
        () =>
          prisma.exception.findFirst({
            where: { applicationId, type: 'CONNECTOR_FAILURE', status: 'OPEN' },
            orderBy: { createdAt: 'desc' },
          }),
        (e) => e !== null,
        25_000,
      );
      expect(exception).not.toBeNull();
    } finally {
      await setMockFailure('EDUCATION', 'OFF');
    }
  });

  /**
   * The property that makes retrying safe, asserted through the engine rather
   * than against the department directly - a stable key is only useful if the
   * code that retries actually reuses it.
   */
  it('reuses one idempotency key across a retry, so nothing is sanctioned twice', async () => {
    const applicationId = await applicationAwaitingDecision();
    const { prisma } = await import('@govflow/core');

    // Fail the first delivery attempt, then let the retry through.
    await setMockFailure('EDUCATION', 'ERROR_500');
    await approve(applicationId);
    await waitFor(
      () => prisma.departmentAcknowledgement.findFirst({ where: { applicationId } }),
      (row) => row !== null && row.attempts >= 1,
      25_000,
    );
    await setMockFailure('EDUCATION', 'OFF');

    const ack = await waitFor(
      () => prisma.departmentAcknowledgement.findFirst({ where: { applicationId } }),
      (row) => row?.status === 'DELIVERED',
      25_000,
    );

    const application = await prisma.application.findUniqueOrThrow({
      where: { id: applicationId },
    });
    expect(ack!.idempotencyKey).toBe(`govflow:${application.applicationNumber}:EDUCATION`);

    // The department must hold exactly one decision for this application. A
    // key that varied per attempt would have produced two sanctions here.
    const recorded = (await (await fetch('http://localhost:5001/api/__decisions')).json()) as {
      education: { payload: { partner_ref?: string } }[];
    };
    const forThisApplication = recorded.education.filter(
      (r) => r.payload.partner_ref === application.applicationNumber,
    );
    expect(forThisApplication).toHaveLength(1);
  });

  it('shows the department reference on the officer view', async () => {
    const applicationId = await applicationAwaitingDecision();
    await approve(applicationId);
    await acknowledgementFor(applicationId);

    const detail = await request(app)
      .get(`/api/officer/applications/${applicationId}`)
      .set('authorization', `Bearer ${officerToken}`)
      .expect(200);

    const acks = detail.body.data.acknowledgements as {
      departmentCode: string;
      departmentReference: string;
      status: string;
    }[];
    expect(acks).toHaveLength(1);
    expect(acks[0]!.status).toBe('DELIVERED');
    expect(acks[0]!.departmentReference).toMatch(/^EDU\/SCH\//);
  });
});

/**
 * Idempotency is the property that makes retrying safe, so it is asserted
 * against the department itself rather than through GovFlow's own bookkeeping.
 */
describe.skipIf(!available)('a retried delivery does not sanction twice', () => {
  const PROVIDER = 'http://localhost:5001';

  async function post(key: string, partnerRef: string) {
    return fetch(`${PROVIDER}/api/education/decisions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from('education:education-demo-pass').toString('base64')}`,
        'idempotency-key': key,
      },
      body: JSON.stringify({
        student_no: 'STU-1001',
        decision_status: 'APPROVED',
        partner_ref: partnerRef,
        decided_by_ref: 'GF-OFF-TEST',
        decision_date: new Date().toISOString(),
      }),
    });
  }

  it('returns the same reference and flags the replay', async () => {
    const key = `test-${Date.now()}`;
    const first = await post(key, 'GF-SCH-TEST-1');
    const second = await post(key, 'GF-SCH-TEST-1');

    const a = (await first.json()) as { ack_id: string; duplicate?: boolean };
    const b = (await second.json()) as { ack_id: string; duplicate?: boolean };

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(b.ack_id).toBe(a.ack_id);
    expect(b.duplicate).toBe(true);
  });

  it('issues distinct references for genuinely distinct decisions', async () => {
    const a = (await (await post(`test-a-${Date.now()}`, 'GF-SCH-TEST-A')).json()) as {
      ack_id: string;
    };
    const b = (await (await post(`test-b-${Date.now()}`, 'GF-SCH-TEST-B')).json()) as {
      ack_id: string;
    };
    expect(a.ack_id).not.toBe(b.ack_id);
  });

  it('refuses a decision with no idempotency key at all', async () => {
    const response = await fetch(`${PROVIDER}/api/education/decisions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from('education:education-demo-pass').toString('base64')}`,
      },
      body: JSON.stringify({
        student_no: 'STU-1001',
        decision_status: 'APPROVED',
        partner_ref: 'GF-SCH-NO-KEY',
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe.skipIf(!available)('departments that cannot receive decisions say so', () => {
  it('declares the capability rather than letting callers assume it', async () => {
    const { createConnector } = await import('@govflow/connector-sdk');

    expect(createConnector('EDUCATION').canReceiveDecisions()).toBe(true);
    expect(createConnector('INCOME').canReceiveDecisions()).toBe(true);
    // A nightly CSV export has no inbox, and the identity registry is asked
    // about people rather than told outcomes.
    expect(createConnector('LEGACY').canReceiveDecisions()).toBe(false);
    expect(createConnector('IDENTITY').canReceiveDecisions()).toBe(false);
  });

  it('fails loudly and non-retryably rather than pretending to deliver', async () => {
    const { createConnector, isConnectorError } = await import('@govflow/connector-sdk');

    const error = await createConnector('LEGACY')
      .submitDecision(
        {
          govflowReference: 'GF-SCH-2026-00001',
          citizenIdentifier: 'CIT-1001',
          serviceType: 'SCHOLARSHIP',
          decision: 'APPROVED',
          decidedAt: new Date().toISOString(),
          officerReference: 'GF-OFF-TEST',
          reason: 'test',
        },
        'key-1',
      )
      .catch((e) => e);

    expect(isConnectorError(error)).toBe(true);
    expect(error.kind).toBe('WRITE_NOT_SUPPORTED');
    // No amount of waiting grows a CSV export an API.
    expect(error.retryable).toBe(false);
  });
});
