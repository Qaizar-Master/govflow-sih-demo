import '../setup/env.js';
import { execSync } from 'node:child_process';
import type { Express } from 'express';
import request from 'supertest';

/** True when Postgres, Redis and the simulated departments are all reachable. */
export async function infraAvailable(): Promise<boolean> {
  try {
    const { prisma } = await import('@govflow/core');
    await prisma.$queryRaw`SELECT 1`;
    const health = await fetch('http://localhost:5001/health', {
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) return false;
    const { getWorkflowQueue } = await import('@govflow/core');
    await getWorkflowQueue().getJobCounts('waiting');
    return true;
  } catch {
    return false;
  }
}

export function skipMessage(): void {
  console.warn(
    '\n[tests] Skipping integration tests: Postgres, Redis or the simulated departments are not reachable.\n' +
      '        Start them with:  npm run infra:up && npm run dev:mocks\n',
  );
}

/** Wipes the test database between files so each starts from a known state. */
export async function resetDatabase(): Promise<void> {
  const { prisma } = await import('@govflow/core');
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.reviewNote.deleteMany();
  await prisma.exception.deleteMany();
  await prisma.connectorLog.deleteMany();
  await prisma.normalizedRecord.deleteMany();
  await prisma.document.deleteMany();
  await prisma.workflowStep.deleteMany();
  await prisma.workflowInstance.deleteMany();
  await prisma.consent.deleteMany();
  await prisma.prefillSnapshot.deleteMany();
  await prisma.application.deleteMany();
  await prisma.identifierLink.deleteMany();
  await prisma.user.deleteMany();
  await prisma.citizen.deleteMany();
  await prisma.department.deleteMany();
}

/** Seeds the departments and one citizen backed by the synthetic registries. */
export async function seedMinimal(externalId = 'CIT-1001') {
  const { prisma, hashPassword } = await import('@govflow/core');
  const { DEPARTMENTS, deriveSeedIdentifier } = await import('@govflow/contracts');

  for (const def of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: def.code },
      create: {
        code: def.code,
        name: def.name,
        type: def.type as never,
        connectorType: def.connector.connectorType as never,
        description: def.description,
        blocking: def.blocking,
        status: 'ONLINE' as never,
      },
      update: { simulatedFailureMode: null, status: 'ONLINE' as never },
    });
  }

  const passwordHash = await hashPassword('Password@123');

  const citizen = await prisma.citizen.create({
    data: {
      externalId,
      name: 'Rohan Prajapati',
      dateOfBirth: new Date('2003-05-12T00:00:00Z'),
      district: 'Pune',
      email: `${externalId.toLowerCase()}@example.gov.in`,
    },
  });
  // Identifier crosswalk. The engine looks these up rather than deriving them,
  // so a fixture citizen with no links can reach no department at all.
  for (const def of DEPARTMENTS) {
    await prisma.identifierLink.create({
      data: {
        citizenId: citizen.id,
        departmentCode: def.code,
        externalIdentifier: deriveSeedIdentifier(externalId, def.code),
        source: 'SEED' as never,
      },
    });
  }

  const citizenUser = await prisma.user.create({
    data: {
      name: 'Rohan Prajapati',
      email: `citizen.${externalId.toLowerCase()}@example.gov.in`,
      passwordHash,
      role: 'CITIZEN' as never,
      citizenId: citizen.id,
    },
  });
  // Officers are scoped to the services their department owns, so a fixture
  // officer needs a department: an account without one has no queue at all.
  const educationUnit = await prisma.department.findUniqueOrThrow({
    where: { code: 'EDUCATION' },
  });
  const revenueUnit = await prisma.department.findUniqueOrThrow({ where: { code: 'INCOME' } });

  const officer = await prisma.user.create({
    data: {
      name: 'Sunita Deshpande',
      email: 'officer@test.govflow',
      passwordHash,
      role: 'OFFICER' as never,
      departmentId: educationUnit.id,
    },
  });
  const revenueOfficer = await prisma.user.create({
    data: {
      name: 'Ramesh Gaikwad',
      email: 'officer.revenue@test.govflow',
      passwordHash,
      role: 'OFFICER' as never,
      departmentId: revenueUnit.id,
    },
  });
  const admin = await prisma.user.create({
    data: {
      name: 'Administrator',
      email: 'admin@test.govflow',
      passwordHash,
      role: 'ADMIN' as never,
    },
  });

  return { citizen, citizenUser, officer, revenueOfficer, admin, password: 'Password@123' };
}

export async function login(app: Express, email: string, password = 'Password@123') {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email, password })
    .expect(200);
  return response.body.data.token as string;
}

/** Puts a simulated department into (or out of) an outage. */
export async function setMockFailure(department: string, mode: string): Promise<void> {
  await fetch(`http://localhost:5001/__control/${department.toLowerCase()}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `predicate` holds or the budget runs out. */
export async function waitFor<T>(
  load: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 20_000,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await load();
  while (!predicate(last)) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out. Last value: ${JSON.stringify(last).slice(0, 400)}`);
    }
    await wait(intervalMs);
    last = await load();
  }
  return last;
}

export { execSync, request };
