import '../setup/env.js';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { infraAvailable, login, resetDatabase, seedMinimal, skipMessage } from './helpers.js';

const available = await infraAvailable();
if (!available) skipMessage();

/**
 * An officer works for one department, and a department owns the outcome of
 * some services and not others. Before this was enforced, every officer saw
 * every application - which made the console incoherent: a Revenue officer
 * could approve a scholarship they have no standing to decide.
 */
describe.skipIf(!available)('officers are scoped to the services their department owns', () => {
  let app: Express;
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;
  let citizenToken: string;
  let educationToken: string;
  let revenueToken: string;
  let adminToken: string;
  let scholarshipId: string;
  let incomeCertificateId: string;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
    const { createApp } = await import('../../apps/api/src/app.js');
    app = createApp();

    citizenToken = await login(app, seeded.citizenUser.email);
    educationToken = await login(app, seeded.officer.email);
    revenueToken = await login(app, seeded.revenueOfficer.email);
    adminToken = await login(app, seeded.admin.email);

    const scholarship = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'SCHOLARSHIP', requestedAmount: 50000 })
      .expect(201);
    scholarshipId = scholarship.body.data.applicationId;

    const certificate = await request(app)
      .post('/api/applications')
      .set('authorization', `Bearer ${citizenToken}`)
      .send({ serviceType: 'INCOME_CERTIFICATE' })
      .expect(201);
    incomeCertificateId = certificate.body.data.applicationId;
  });

  it('shows each officer only the services their department owns', async () => {
    const education = await request(app)
      .get('/api/officer/applications?pageSize=50')
      .set('authorization', `Bearer ${educationToken}`)
      .expect(200);
    const revenue = await request(app)
      .get('/api/officer/applications?pageSize=50')
      .set('authorization', `Bearer ${revenueToken}`)
      .expect(200);

    const types = (body: { data: { items: { serviceType: string }[] } }) =>
      new Set(body.data.items.map((i) => i.serviceType));

    expect(types(education.body)).toEqual(new Set(['SCHOLARSHIP']));
    expect(types(revenue.body)).toEqual(new Set(['INCOME_CERTIFICATE']));
  });

  it('reports an out-of-scope application as not found, never as forbidden', async () => {
    // 403 would confirm the id exists. 404 matches how a citizen is refused
    // somebody else's application.
    await request(app)
      .get(`/api/officer/applications/${incomeCertificateId}`)
      .set('authorization', `Bearer ${educationToken}`)
      .expect(404);

    await request(app)
      .get(`/api/officer/applications/${scholarshipId}`)
      .set('authorization', `Bearer ${revenueToken}`)
      .expect(404);
  });

  it('refuses a decision on an application the officer does not own', async () => {
    await request(app)
      .post(`/api/officer/applications/${incomeCertificateId}/approve`)
      .set('authorization', `Bearer ${educationToken}`)
      .send({ notes: 'attempting a cross-department approval' })
      .expect(404);

    await request(app)
      .post(`/api/officer/applications/${scholarshipId}/reject`)
      .set('authorization', `Bearer ${revenueToken}`)
      .send({ notes: 'attempting a cross-department rejection' })
      .expect(404);
  });

  it('refuses a review note on an application the officer does not own', async () => {
    await request(app)
      .post(`/api/applications/${incomeCertificateId}/notes`)
      .set('authorization', `Bearer ${educationToken}`)
      .send({ note: 'a note from the wrong department' })
      .expect(404);
  });

  it('keeps the header metrics consistent with the queue below them', async () => {
    const metrics = await request(app)
      .get('/api/officer/metrics')
      .set('authorization', `Bearer ${revenueToken}`)
      .expect(200);
    // One income-certificate application exists; the scholarship must not be
    // counted, or the header would contradict the list.
    expect(metrics.body.data.total).toBe(1);
  });

  it('leaves admins unrestricted - they operate the platform, not the queue', async () => {
    const response = await request(app)
      .get('/api/officer/applications?pageSize=50')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const types = new Set(
      (response.body.data.items as { serviceType: string }[]).map((i) => i.serviceType),
    );
    expect(types).toEqual(new Set(['SCHOLARSHIP', 'INCOME_CERTIFICATE']));
  });

  it('refuses an officer account with no department instead of widening it', async () => {
    const { prisma, hashPassword } = await import('@govflow/core');
    await prisma.user.create({
      data: {
        name: 'Unassigned Officer',
        email: 'stray@test.govflow',
        passwordHash: await hashPassword('Password@123'),
        role: 'OFFICER' as never,
      },
    });
    const token = await login(app, 'stray@test.govflow');
    await request(app)
      .get('/api/officer/applications')
      .set('authorization', `Bearer ${token}`)
      .expect(403);
  });
});

/**
 * Departmental keyspaces are independent. The demo dataset aligns their
 * numeric suffixes, which makes derivation look like it works - so the rule
 * that it must be a stored, attributed link is asserted rather than assumed.
 */
describe.skipIf(!available)('identifier crosswalk is looked up, not derived', () => {
  let seeded: Awaited<ReturnType<typeof seedMinimal>>;

  beforeAll(async () => {
    await resetDatabase();
    seeded = await seedMinimal('CIT-1001');
  });

  it('resolves each department identifier from the stored link', async () => {
    const { resolveDepartmentIdentifier } = await import('@govflow/core');
    await expect(resolveDepartmentIdentifier(seeded.citizen.id, 'INCOME')).resolves.toMatchObject({
      identifier: 'INC-1001',
      source: 'SEED',
    });
    await expect(
      resolveDepartmentIdentifier(seeded.citizen.id, 'EDUCATION'),
    ).resolves.toMatchObject({ identifier: 'STU-1001' });
  });

  it('fails non-retryably when no link exists, rather than guessing one', async () => {
    const { prisma, resolveDepartmentIdentifier } = await import('@govflow/core');
    const { isConnectorError } = await import('@govflow/connector-sdk');

    await prisma.identifierLink.delete({
      where: {
        citizenId_departmentCode: { citizenId: seeded.citizen.id, departmentCode: 'INCOME' },
      },
    });

    const error = await resolveDepartmentIdentifier(seeded.citizen.id, 'INCOME').catch((e) => e);
    expect(isConnectorError(error)).toBe(true);
    expect(error.kind).toBe('IDENTIFIER_NOT_LINKED');
    // Retrying cannot establish a fact about the citizen.
    expect(error.retryable).toBe(false);
  });

  it('records where a link came from, so an unattributed link is impossible', async () => {
    const { linkDepartmentIdentifier, listIdentifierLinks } = await import('@govflow/core');
    await linkDepartmentIdentifier({
      citizenId: seeded.citizen.id,
      departmentCode: 'INCOME',
      externalIdentifier: 'INC-9999',
      source: 'OFFICER_ASSERTED',
      verifiedAt: new Date(),
    });

    const links = await listIdentifierLinks(seeded.citizen.id);
    expect(links.INCOME).toMatchObject({
      identifier: 'INC-9999',
      source: 'OFFICER_ASSERTED',
    });
    expect(links.INCOME.verifiedAt).toBeInstanceOf(Date);
  });
});
