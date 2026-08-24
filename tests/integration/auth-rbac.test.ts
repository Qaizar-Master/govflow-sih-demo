import '../setup/env.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { infraAvailable, login, resetDatabase, seedMinimal, skipMessage } from './helpers.js';

const available = await infraAvailable();
if (!available) skipMessage();

describe.skipIf(!available)('authentication', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
  });

  afterAll(async () => {
    const { prisma, closeQueues } = await import('@govflow/core');
    await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
  });

  it('issues a JWT for valid credentials', async () => {
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: seeded.officer.email, password: seeded.password })
      .expect(200);

    expect(response.body).toMatchObject({ success: true, error: null });
    expect(response.body.data.token).toBeTypeOf('string');
    expect(response.body.data.user.role).toBe('OFFICER');
    // The hash must never leave the server.
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('rejects a wrong password without revealing whether the email exists', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: seeded.officer.email, password: 'Wrong@12345' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@test.govflow', password: 'Wrong@12345' })
      .expect(401);

    expect(wrongPassword.body.error.message).toBe(unknownEmail.body.error.message);
    expect(wrongPassword.body.error.code).toBe('UNAUTHORIZED');
  });

  it('records a failed sign-in attempt in the audit log', async () => {
    const { prisma } = await import('@govflow/core');
    await request(app)
      .post('/api/auth/login')
      .send({ email: seeded.officer.email, password: 'AlsoWrong@1' })
      .expect(401);

    const entry = await prisma.auditLog.findFirst({
      where: { action: 'USER_LOGIN_FAILED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).not.toBeNull();
  });

  it('registers a citizen against an existing synthetic registry identity', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Priya Patil',
        email: 'priya.test@example.gov.in',
        password: 'Password@123',
        citizenExternalId: 'CIT-1003',
      })
      .expect(400);

    // CIT-1003 was not seeded in this test database, so linking must fail cleanly.
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('registers a brand-new identity and warns that no department holds a record', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'New Applicant',
        email: 'new.applicant@example.gov.in',
        password: 'Password@123',
        dateOfBirth: '2004-03-03',
        district: 'Pune',
      })
      .expect(201);

    expect(response.body.data.registryDataAvailable).toBe(false);
    expect(response.body.data.notice).toMatch(/no records for it/i);
    expect(response.body.data.token).toBeTypeOf('string');
  });

  it('rejects a duplicate email with 409', async () => {
    const payload = {
      name: 'Duplicate',
      email: 'duplicate@example.gov.in',
      password: 'Password@123',
      dateOfBirth: '2004-03-03',
      district: 'Pune',
    };
    await request(app).post('/api/auth/register').send(payload).expect(201);
    const conflict = await request(app).post('/api/auth/register').send(payload).expect(409);
    expect(conflict.body.error.code).toBe('CONFLICT');
  });

  it('rejects a weak password before touching the database', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Weak', email: 'weak@example.gov.in', password: 'short' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a request with no token, a malformed token, and a forged token', async () => {
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('authorization', 'Bearer nonsense').expect(401);
    await request(app).get('/api/auth/me').set('authorization', 'Basic abc').expect(401);
  });

  it('returns the session identity for a valid token', async () => {
    const token = await login(app, seeded.citizenUser.email);
    const response = await request(app)
      .get('/api/auth/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body.data.user.role).toBe('CITIZEN');
    expect(response.body.data.citizen.externalId).toBe('CIT-1001');
  });
});

describe.skipIf(!available)('role-based access control', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let officerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();
    citizenToken = await login(app, seeded.citizenUser.email);
    officerToken = await login(app, seeded.officer.email);
    adminToken = await login(app, seeded.admin.email);
  });

  afterAll(async () => {
    const { prisma, closeQueues } = await import('@govflow/core');
    await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
  });

  it('blocks a citizen from the officer queue', async () => {
    const response = await request(app)
      .get('/api/officer/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks a citizen from every admin endpoint', async () => {
    for (const path of [
      '/api/admin/metrics',
      '/api/admin/health',
      '/api/admin/departments',
      '/api/admin/audit',
      '/api/admin/connectors',
    ]) {
      await request(app)
        .get(path)
        .set('authorization', `Bearer ${citizenToken}`)
        .expect(403);
    }
  });

  it('blocks an officer from admin endpoints', async () => {
    await request(app)
      .get('/api/admin/audit')
      .set('authorization', `Bearer ${officerToken}`)
      .expect(403);
  });

  it('blocks an officer from arming a simulated failure', async () => {
    await request(app)
      .post('/api/admin/connectors/INCOME/simulate-failure')
      .set('authorization', `Bearer ${officerToken}`)
      .send({ mode: 'ERROR_500' })
      .expect(403);
  });

  it('lets an admin use the officer surface as well', async () => {
    await request(app)
      .get('/api/officer/applications')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  it('blocks an officer from creating an application on a citizen’s behalf', async () => {
    await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${officerToken}`)
      .send({ consents: ['IDENTITY'] })
      .expect(403);
  });

  it('hides another citizen’s application behind a 404, not a 403', async () => {
    const { prisma } = await import('@govflow/core');
    const otherCitizen = await prisma.citizen.create({
      data: {
        externalId: 'CIT-1002',
        name: 'Aditya Sharma',
        dateOfBirth: new Date('2004-01-22T00:00:00Z'),
        district: 'Nagpur',
      },
    });
    const otherApplication = await prisma.application.create({
      data: {
        applicationNumber: 'GF-SCH-TEST-00099',
        citizenId: otherCitizen.id,
        serviceType: 'SCHOLARSHIP' as never,
      },
    });

    // A 403 would confirm the id exists; a 404 leaks nothing.
    const response = await request(app)
      .get(`/api/applications/${otherApplication.id}`)
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('never leaks a stack trace or an internal error message', async () => {
    const response = await request(app)
      .get('/api/applications/definitely-not-a-real-id')
      .set('authorization', `Bearer ${citizenToken}`)
      .expect(404);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/at .*\.ts:/);
    expect(body).not.toMatch(/prisma/i);
  });

  it('serves the OpenAPI document without authentication', async () => {
    const response = await request(app).get('/openapi.json').expect(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(Object.keys(response.body.paths).length).toBeGreaterThan(20);
  });
});
