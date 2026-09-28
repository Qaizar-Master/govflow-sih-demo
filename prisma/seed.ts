/**
 * GovFlow demo seed.
 *
 * Everything here is SYNTHETIC. Normalised payloads are produced by running the
 * real connector transforms over the same synthetic department datasets the mock
 * services serve, so seeded history and live workflow runs agree exactly.
 *
 * Idempotent: does nothing if the database already has users, unless run with
 * `--force`, which wipes the demo data first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createConnector } from '@govflow/connector-sdk';
import {
  DEPARTMENTS,
  DataType,
  REPO_ROOT,
  deriveSeedIdentifier,
  formFields,
  getServiceDefinition,
  env,
  type IdentityFacts,
} from '@govflow/contracts';
// Reuses the shared client so the Prisma 7 driver adapter is configured once.
import { hashPassword, prisma } from '@govflow/core';
import { EDUCATION, IDENTITY, INCOME } from '../services/mock-departments/src/data.js';

const FORCE = process.argv.includes('--force');
const DEMO_PASSWORD = 'Password@123';

const DOCS_DIR = path.join(REPO_ROOT, 'data', 'documents');

// ---------------------------------------------------------------------------
// Synthetic certificate files (text-layer documents so OCR works offline)
// ---------------------------------------------------------------------------

function incomeCertificate(name: string, district: string, income: number, certNo: string): string {
  return `GOVERNMENT OF MAHARASHTRA  (SYNTHETIC SPECIMEN - NOT A REAL DOCUMENT)
OFFICE OF THE TAHSILDAR, ${district.toUpperCase()}

                       INCOME CERTIFICATE

Certificate No: ${certNo}
Applicant Name: ${name}
District: ${district}
Annual Income: INR ${income}
Assessment Year: 2026
Date of Issue: 14/04/2026

This is to certify that the annual family income of the above named
applicant, from all sources, is as stated above.

                                              Signature (specimen)
                                              Tahsildar, ${district}
`;
}

function educationCertificate(
  name: string,
  institution: string,
  course: string,
  certNo: string,
): string {
  return `${institution.toUpperCase()}  (SYNTHETIC SPECIMEN - NOT A REAL DOCUMENT)
OFFICE OF THE REGISTRAR

                     BONAFIDE / EDUCATION CERTIFICATE

Certificate No: ${certNo}
Student Name: ${name}
Institution: ${institution}
Course: ${course}
Academic Year: 2025-26
Enrolment Status: ACTIVE
Date of Issue: 02/04/2026

This is to certify that the above named student is a bonafide student of
this institution for the academic year stated.

                                              Signature (specimen)
                                              Registrar
`;
}

interface WrittenDoc {
  fileName: string;
  storagePath: string;
  sizeBytes: number;
}

function writeDoc(fileName: string, content: string): WrittenDoc {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
  const storagePath = path.join(DOCS_DIR, fileName);
  fs.writeFileSync(storagePath, content, 'utf8');
  return { fileName, storagePath, sizeBytes: Buffer.byteLength(content, 'utf8') };
}

// ---------------------------------------------------------------------------
// Normalisation through the real connectors
// ---------------------------------------------------------------------------

const identityConnector = createConnector('IDENTITY');
const incomeConnector = createConnector('INCOME');
const educationConnector = createConnector('EDUCATION');
const legacyConnector = createConnector('LEGACY');

/** Narrows the connector's discriminated union to identity facts. */
function asIdentityFacts(row: (typeof IDENTITY)[number]): IdentityFacts {
  const record = identityConnector.transform(row);
  if (record.dataType !== DataType.IDENTITY) {
    throw new Error('identity connector produced an unexpected record type');
  }
  return record.facts;
}

function identityFacts(citizenId: string) {
  const row = IDENTITY.find((r) => r.citizenId === citizenId);
  return row ? (identityConnector.transform(row).facts as Record<string, unknown>) : null;
}
function incomeFacts(citizenId: string) {
  const row = INCOME.find((r) => r.applicant_id === citizenId.replace('CIT-', 'INC-'));
  return row ? (incomeConnector.transform(row).facts as Record<string, unknown>) : null;
}
function educationFacts(citizenId: string) {
  const row = EDUCATION.find((r) => r.student_no === citizenId.replace('CIT-', 'STU-'));
  return row ? (educationConnector.transform(row).facts as Record<string, unknown>) : null;
}
function legacyFacts(citizenId: string) {
  const raw = fs.readFileSync(env.LEGACY_CSV_PATH, 'utf8');
  const [header, ...lines] = raw.trim().split('\n');
  const cols = header!.split(',');
  for (const line of lines) {
    // The demo export has at most one quoted field; a full CSV parse lives in
    // the connector, this is only here to pick a row for seeding.
    const values = line.match(/("[^"]*"|[^,]*)/g)?.filter((_, i) => i % 2 === 0) ?? [];
    const row: Record<string, string> = {};
    cols.forEach((c, i) => {
      row[c] = (values[i] ?? '').replace(/^"|"$/g, '');
    });
    if (row.citizen_ref === citizenId) {
      return legacyConnector.transform(row).facts as Record<string, unknown>;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Application scenarios
// ---------------------------------------------------------------------------

type Scenario =
  | 'APPROVED_CLEAN'
  | 'UNDER_REVIEW_CLEAN'
  | 'MISMATCH'
  | 'MISSING_DOCUMENT'
  | 'CONNECTOR_FAILURE'
  | 'SLA_AT_RISK'
  | 'SLA_OVERDUE'
  | 'REJECTED'
  | 'AWAITING_CONSENT'
  | 'IN_FLIGHT';

interface AppSpec {
  citizenId: string;
  scenario: Scenario;
  submittedDaysAgo: number;
  requestedAmount: number;
  /** Defaults to the scholarship scheme. */
  serviceType?: 'SCHOLARSHIP' | 'INCOME_CERTIFICATE' | 'RATION_CARD';
}

const APP_SPECS: AppSpec[] = [
  { citizenId: 'CIT-1002', scenario: 'APPROVED_CLEAN', submittedDaysAgo: 6, requestedAmount: 50000 },
  { citizenId: 'CIT-1008', scenario: 'UNDER_REVIEW_CLEAN', submittedDaysAgo: 1, requestedAmount: 60000 },
  { citizenId: 'CIT-1009', scenario: 'MISMATCH', submittedDaysAgo: 2, requestedAmount: 45000 },
  { citizenId: 'CIT-1003', scenario: 'MISSING_DOCUMENT', submittedDaysAgo: 2, requestedAmount: 40000 },
  { citizenId: 'CIT-1006', scenario: 'CONNECTOR_FAILURE', submittedDaysAgo: 3, requestedAmount: 55000 },
  { citizenId: 'CIT-1004', scenario: 'SLA_AT_RISK', submittedDaysAgo: 4, requestedAmount: 50000 },
  { citizenId: 'CIT-1005', scenario: 'SLA_OVERDUE', submittedDaysAgo: 7, requestedAmount: 65000 },
  { citizenId: 'CIT-1007', scenario: 'REJECTED', submittedDaysAgo: 5, requestedAmount: 40000 },
  { citizenId: 'CIT-1010', scenario: 'AWAITING_CONSENT', submittedDaysAgo: 0, requestedAmount: 48000 },
  { citizenId: 'CIT-1008', scenario: 'IN_FLIGHT', submittedDaysAgo: 0, requestedAmount: 52000 },

  // The same four connectors, two more services. Nothing was integrated twice.
  {
    citizenId: 'CIT-1006',
    scenario: 'APPROVED_CLEAN',
    submittedDaysAgo: 2,
    requestedAmount: 0,
    serviceType: 'INCOME_CERTIFICATE',
  },
  {
    citizenId: 'CIT-1003',
    scenario: 'UNDER_REVIEW_CLEAN',
    submittedDaysAgo: 1,
    requestedAmount: 0,
    serviceType: 'INCOME_CERTIFICATE',
  },
  // Already in the legacy beneficiary register - a possible duplicate claim.
  {
    citizenId: 'CIT-1001',
    scenario: 'MISMATCH',
    submittedDaysAgo: 3,
    requestedAmount: 0,
    serviceType: 'RATION_CARD',
  },
  {
    citizenId: 'CIT-1004',
    scenario: 'UNDER_REVIEW_CLEAN',
    submittedDaysAgo: 1,
    requestedAmount: 0,
    serviceType: 'RATION_CARD',
  },
];

/** Which steps have completed, and the resulting statuses, per scenario. */
function planFor(scenario: Scenario, serviceType: string) {
  const steps = getServiceDefinition(serviceType).steps;
  const all = steps.map((s) => s.stepType);
  // Everything up to and including the data-quality check runs automatically.
  const automated = all.slice(0, all.indexOf('DATA_QUALITY_CHECK') + 1);

  switch (scenario) {
    case 'APPROVED_CLEAN':
      return {
        completed: all,
        applicationStatus: 'APPROVED' as const,
        workflowStatus: 'COMPLETED' as const,
        currentStep: 'FINAL_DECISION' as const,
        decided: 'APPROVE' as const,
      };
    case 'REJECTED':
      return {
        completed: all.slice(0, all.length - 1),
        rejectedStep: 'FINAL_DECISION' as const,
        applicationStatus: 'REJECTED' as const,
        workflowStatus: 'COMPLETED' as const,
        currentStep: 'FINAL_DECISION' as const,
        decided: 'REJECT' as const,
      };
    case 'UNDER_REVIEW_CLEAN':
      return {
        completed: automated,
        reviewStep: 'OFFICER_REVIEW' as const,
        applicationStatus: 'UNDER_REVIEW' as const,
        workflowStatus: 'WAITING_FOR_OFFICER' as const,
        currentStep: 'OFFICER_REVIEW' as const,
      };
    case 'SLA_AT_RISK':
      return {
        completed: automated,
        reviewStep: 'OFFICER_REVIEW' as const,
        applicationStatus: 'UNDER_REVIEW' as const,
        workflowStatus: 'WAITING_FOR_OFFICER' as const,
        currentStep: 'OFFICER_REVIEW' as const,
      };
    case 'MISSING_DOCUMENT':
      // Blocked at the document gate: only the citizen can clear it.
      return {
        completed: all.slice(0, all.indexOf('DOCUMENT_VALIDATION')),
        applicationStatus: 'AWAITING_CITIZEN_ACTION' as const,
        workflowStatus: 'SUSPENDED' as const,
        currentStep: 'DOCUMENT_VALIDATION' as const,
        citizenBlocked: true,
      };
    case 'MISMATCH':
    case 'SLA_OVERDUE':
      return {
        completed: automated,
        reviewStep: 'OFFICER_REVIEW' as const,
        applicationStatus: 'REQUIRES_REVIEW' as const,
        workflowStatus: 'WAITING_FOR_OFFICER' as const,
        currentStep: 'OFFICER_REVIEW' as const,
      };
    case 'CONNECTOR_FAILURE':
      return {
        completed: ['CONSENT', 'IDENTITY_VERIFICATION'] as const,
        failedStep: 'INCOME_VERIFICATION' as const,
        applicationStatus: 'REQUIRES_REVIEW' as const,
        workflowStatus: 'SUSPENDED' as const,
        currentStep: 'INCOME_VERIFICATION' as const,
      };
    case 'AWAITING_CONSENT':
      return {
        completed: [] as const,
        pendingConsent: true,
        applicationStatus: 'PROCESSING' as const,
        workflowStatus: 'SUSPENDED' as const,
        currentStep: 'CONSENT' as const,
      };
    case 'IN_FLIGHT':
    default:
      return {
        completed: ['CONSENT', 'IDENTITY_VERIFICATION', 'INCOME_VERIFICATION'] as const,
        inProgressStep: 'EDUCATION_VERIFICATION' as const,
        applicationStatus: 'PROCESSING' as const,
        workflowStatus: 'RUNNING' as const,
        currentStep: 'EDUCATION_VERIFICATION' as const,
      };
  }
}

/** Application numbers carry the service, the way real dockets do. */
const APPLICATION_PREFIX: Record<string, string> = {
  SCHOLARSHIP: 'GF-SCH',
  INCOME_CERTIFICATE: 'GF-INC',
  RATION_CARD: 'GF-PDS',
};

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3_600_000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3_600_000);

async function wipe() {
  // Order matters only where cascades are absent.
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
  await prisma.application.deleteMany();
  await prisma.identifierLink.deleteMany();
  await prisma.user.deleteMany();
  await prisma.citizen.deleteMany();
  await prisma.department.deleteMany();
}

async function main() {
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !FORCE) {
    console.log(
      `[seed] database already has ${existingUsers} user(s) - nothing to do. Use "npm run db:reset" to reseed.`,
    );
    return;
  }
  if (FORCE) {
    console.log('[seed] --force: clearing existing demo data');
    await wipe();
  }

  // ---- Departments ------------------------------------------------------
  for (const def of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { code: def.code },
      create: {
        code: def.code,
        name: def.name,
        type: def.type as never,
        connectorType: def.connector.connectorType as never,
        description: def.description,
        endpoint:
          def.connector.connectorType === 'REST_JSON'
            ? `${def.connector.baseUrl}${def.connector.resourcePath}`
            : def.connector.filePath,
        blocking: def.blocking,
        status: 'ONLINE' as never,
      },
      update: {
        name: def.name,
        description: def.description,
        blocking: def.blocking,
      },
    });
  }
  console.log(`[seed] ${DEPARTMENTS.length} departments`);

  // ---- Staff accounts ---------------------------------------------------
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const educationUnit = await prisma.department.findUniqueOrThrow({ where: { code: 'EDUCATION' } });
  const revenueUnit = await prisma.department.findUniqueOrThrow({ where: { code: 'INCOME' } });

  // One officer per owning department, because department scoping is only
  // demonstrable if the two officers actually see different queues:
  // Education owns the scholarship; Revenue owns income certificates and
  // ration cards.
  const officer = await prisma.user.create({
    data: {
      name: 'Sunita Deshpande',
      email: 'officer@govflow.gov.in',
      passwordHash,
      role: 'OFFICER' as never,
      departmentId: educationUnit.id,
    },
  });
  const officer2 = await prisma.user.create({
    data: {
      name: 'Ramesh Gaikwad',
      email: 'officer2@govflow.gov.in',
      passwordHash,
      role: 'OFFICER' as never,
      departmentId: revenueUnit.id,
    },
  });
  const admin = await prisma.user.create({
    data: {
      name: 'Platform Administrator',
      email: 'admin@govflow.gov.in',
      passwordHash,
      role: 'ADMIN' as never,
    },
  });
  console.log('[seed] officer + admin accounts');

  /**
   * The officer who would actually have handled this file. Decisions and notes
   * are attributed through the owning department, so the seeded history obeys
   * the same scoping rule the API now enforces - otherwise the demo would open
   * on a queue full of decisions its own officer was not allowed to make.
   */
  const officerFor = (service: { owningDepartment: string }) =>
    service.owningDepartment === 'EDUCATION' ? officer : officer2;

  // ---- Citizens & their logins ------------------------------------------
  const citizenByExternalId = new Map<string, { id: string; userId: string; name: string }>();

  for (const row of IDENTITY) {
    const facts = asIdentityFacts(row);
    const slug = facts.name.toLowerCase().replace(/[^a-z]+/g, '.');
    const citizen = await prisma.citizen.create({
      data: {
        externalId: facts.citizenId,
        name: facts.name,
        dateOfBirth: new Date(`${facts.dateOfBirth}T00:00:00Z`),
        district: facts.district,
        email: `${slug}@example.gov.in`,
        phone: `+91-9${String(700000000 + Number(facts.citizenId.replace(/\D/g, '')))}`,
      },
    });
    const user = await prisma.user.create({
      data: {
        name: facts.name,
        email: `${slug}@example.gov.in`,
        passwordHash,
        role: 'CITIZEN' as never,
        citizenId: citizen.id,
      },
    });
    // Identifier crosswalk. At runtime GovFlow looks these up rather than
    // deriving them, so the demo dataset has to state them explicitly - which
    // is the point: a link is a recorded fact with a provenance, and SEED is an
    // honest provenance meaning "synthetic, carries no assurance".
    for (const dept of DEPARTMENTS) {
      await prisma.identifierLink.create({
        data: {
          citizenId: citizen.id,
          departmentCode: dept.code,
          externalIdentifier: deriveSeedIdentifier(facts.citizenId, dept.code),
          source: 'SEED' as never,
          verifiedAt: null,
        },
      });
    }

    citizenByExternalId.set(facts.citizenId, {
      id: citizen.id,
      userId: user.id,
      name: facts.name,
    });
  }
  console.log(
    `[seed] ${citizenByExternalId.size} citizens with logins and ${DEPARTMENTS.length} identifier links each`,
  );

  // ---- Applications -----------------------------------------------------
  let seq = 0;
  for (const spec of APP_SPECS) {
    seq += 1;
    const citizen = citizenByExternalId.get(spec.citizenId);
    if (!citizen) continue;

    const serviceType = spec.serviceType ?? 'SCHOLARSHIP';
    const service = getServiceDefinition(serviceType);
    const plan = planFor(spec.scenario, serviceType);
    const completed = new Set<string>(plan.completed as readonly string[]);
    const submittedAt = daysAgo(spec.submittedDaysAgo);
    const identity = identityFacts(spec.citizenId);
    const income = incomeFacts(spec.citizenId);
    const education = educationFacts(spec.citizenId);
    const legacy = legacyFacts(spec.citizenId);
    const educationRow = EDUCATION.find(
      (r) => r.student_no === spec.citizenId.replace('CIT-', 'STU-'),
    );

    const application = await prisma.application.create({
      data: {
        applicationNumber: `${APPLICATION_PREFIX[serviceType]}-2026-${String(seq).padStart(5, '0')}`,
        citizenId: citizen.id,
        serviceType: serviceType as never,
        status: plan.applicationStatus as never,
        currentStep: plan.currentStep as never,
        requestedAmount: spec.requestedAmount,
        institutionClaim: (education?.institution as string | undefined) ?? null,
        slaTargetDays: service.slaTargetDays,
        submittedAt,
        createdAt: submittedAt,
        decisionAt:
          plan.decided !== undefined ? hoursAgo(spec.submittedDaysAgo * 24 - 30) : null,
        decidedById: plan.decided !== undefined ? officerFor(service).id : null,
        decisionNotes:
          plan.decided === 'APPROVE'
            ? 'All three departments agree and both certificates match the registries. Sanctioned under the state merit-cum-means scheme.'
            : plan.decided === 'REJECT'
              ? 'Education Department reports the enrolment as INACTIVE. The scheme requires an active enrolment, so the application is rejected.'
              : null,
      },
    });

    // Consents
    const consentScopes = service.consentScopes.map((scope) => ({
      code: scope.departmentCode,
      purpose: scope.purpose,
    }));
    for (const scope of consentScopes) {
      const pending = 'pendingConsent' in plan && plan.pendingConsent && scope.code === 'EDUCATION';
      await prisma.consent.create({
        data: {
          applicationId: application.id,
          citizenId: citizen.id,
          departmentCode: scope.code,
          purpose: scope.purpose,
          status: (pending ? 'PENDING' : 'GRANTED') as never,
          grantedAt: pending ? null : submittedAt,
          expiresAt: new Date(submittedAt.getTime() + 90 * 24 * 3_600_000),
          createdAt: submittedAt,
        },
      });
    }

    // Workflow instance + steps
    const workflow = await prisma.workflowInstance.create({
      data: {
        applicationId: application.id,
        status: plan.workflowStatus as never,
        currentStep: plan.currentStep as never,
        startedAt: submittedAt,
        completedAt: plan.workflowStatus === 'COMPLETED' ? application.decisionAt : null,
        createdAt: submittedAt,
      },
    });

    for (const def of service.steps) {
      let status = 'PENDING';
      let errorMessage: string | null = null;
      let retryCount = 0;

      if (completed.has(def.stepType)) status = 'COMPLETED';
      if ('failedStep' in plan && plan.failedStep === def.stepType) {
        status = 'REQUIRES_REVIEW';
        retryCount = 3;
        errorMessage =
          'State Income & Revenue Department (Simulated) is not responding correctly: upstream returned HTTP 503';
      }
      if ('inProgressStep' in plan && plan.inProgressStep === def.stepType) {
        status = 'IN_PROGRESS';
      }
      if ('reviewStep' in plan && plan.reviewStep === def.stepType) {
        status = 'REQUIRES_REVIEW';
      }
      if ('rejectedStep' in plan && plan.rejectedStep === def.stepType) {
        status = 'REJECTED';
      }
      if ('pendingConsent' in plan && plan.pendingConsent && def.stepType === 'CONSENT') {
        errorMessage = 'Awaiting citizen consent for: EDUCATION';
      }
      if (
        'citizenBlocked' in plan &&
        plan.citizenBlocked &&
        def.stepType === 'DOCUMENT_VALIDATION'
      ) {
        errorMessage = 'Awaiting required document(s): income certificate';
      }

      const stepStart =
        status === 'PENDING'
          ? null
          : new Date(submittedAt.getTime() + def.order * 4 * 60_000);

      await prisma.workflowStep.create({
        data: {
          workflowInstanceId: workflow.id,
          stepType: def.stepType as never,
          order: def.order,
          label: def.label,
          department: def.departmentCode,
          status: status as never,
          retryCount,
          maxAttempts: 3,
          startedAt: stepStart,
          completedAt: status === 'COMPLETED' || status === 'REJECTED' ? stepStart : null,
          errorMessage,
          createdAt: submittedAt,
        },
      });
    }

    // Normalised records for whichever departments were reached
    const recordPlan: { type: string; source: string; facts: Record<string, unknown> | null; mapping: string; step: string }[] = [
      { type: 'IDENTITY', source: 'IDENTITY_REGISTRY', facts: identity, mapping: 'identity-registry-v1', step: 'IDENTITY_VERIFICATION' },
      { type: 'INCOME', source: 'INCOME_DEPARTMENT', facts: income, mapping: 'income-department-v2', step: 'INCOME_VERIFICATION' },
      { type: 'EDUCATION', source: 'EDUCATION_DEPARTMENT', facts: education, mapping: 'education-department-v1', step: 'EDUCATION_VERIFICATION' },
      { type: 'LEGACY_BENEFICIARY', source: 'LEGACY_BENEFICIARY_SYSTEM', facts: legacy, mapping: 'legacy-beneficiary-csv-v1', step: 'LEGACY_CROSS_CHECK' },
    ];
    for (const entry of recordPlan) {
      if (!entry.facts || !completed.has(entry.step)) continue;
      const warnings: string[] = [];
      if (entry.type === 'INCOME' && typeof entry.facts.incomeYear === 'number') {
        if (new Date().getFullYear() - (entry.facts.incomeYear as number) >= 2) {
          warnings.push(`Income assessment is from ${entry.facts.incomeYear} and may be out of date.`);
        }
        if (!entry.facts.certificateNumber) {
          warnings.push('Income Department record carries no certificate number.');
        }
      }
      if (entry.type === 'EDUCATION' && entry.facts.educationStatus !== 'ACTIVE') {
        warnings.push(
          `Enrolment status is "${entry.facts.educationStatus}" - the scheme expects ACTIVE or ENROLLED.`,
        );
      }
      if (entry.type === 'LEGACY_BENEFICIARY' && entry.facts.verificationStatus !== 'VERIFIED') {
        warnings.push(`Legacy system reports verification status "${entry.facts.verificationStatus}".`);
      }
      await prisma.normalizedRecord.create({
        data: {
          applicationId: application.id,
          citizenId: citizen.id,
          sourceSystem: entry.source,
          sourceRecordId: String(entry.facts.citizenId ?? spec.citizenId),
          dataType: entry.type as never,
          normalizedPayload: entry.facts as never,
          qualityWarnings: warnings,
          validationStatus: (warnings.length ? 'WARNING' : 'PASSED') as never,
          mappingName: entry.mapping,
          receivedAt: new Date(submittedAt.getTime() + 10 * 60_000),
        },
      });
    }

    // Documents. The MISSING_DOCUMENT scenario deliberately omits the income one.
    const wantDocuments = completed.has('DOCUMENT_VALIDATION') || spec.scenario === 'CONNECTOR_FAILURE';
    if (wantDocuments && identity) {
      const certNo = `INC/2026/${44800 + seq}`;
      const incomeAmount = Number(income?.annualIncome ?? 150000);

      if (spec.scenario !== 'MISSING_DOCUMENT') {
        const file = writeDoc(
          `income-certificate-${spec.citizenId}.txt`,
          incomeCertificate(String(identity.name), String(identity.district), incomeAmount, certNo),
        );
        await prisma.document.create({
          data: {
            applicationId: application.id,
            documentType: 'INCOME_CERTIFICATE' as never,
            fileName: file.fileName,
            storagePath: file.storagePath,
            mimeType: 'text/plain',
            sizeBytes: file.sizeBytes,
            extractionStatus: 'COMPLETED' as never,
            extractionEngine: 'TEXT_LAYER+RULE_BASED',
            extractedData: {
              documentType: 'INCOME_CERTIFICATE',
              name: identity.name,
              certificateNumber: certNo,
              annualIncome: incomeAmount,
              issuedDate: '2026-04-14',
              district: identity.district,
              institution: null,
              course: null,
            } as never,
            validationStatus: 'PASSED' as never,
            validationNotes: 'Read directly from the document text layer.',
            uploadedAt: new Date(submittedAt.getTime() + 5 * 60_000),
          },
        });
      }

      if (educationRow) {
        const eduCertNo = `EDU/2026/${9100 + seq}`;
        const file = writeDoc(
          `education-certificate-${spec.citizenId}.txt`,
          educationCertificate(
            educationRow.studentName,
            educationRow.institution_name,
            educationRow.course ?? 'Undergraduate Programme',
            eduCertNo,
          ),
        );
        await prisma.document.create({
          data: {
            applicationId: application.id,
            documentType: 'EDUCATION_CERTIFICATE' as never,
            fileName: file.fileName,
            storagePath: file.storagePath,
            mimeType: 'text/plain',
            sizeBytes: file.sizeBytes,
            extractionStatus: 'COMPLETED' as never,
            extractionEngine: 'TEXT_LAYER+RULE_BASED',
            extractedData: {
              documentType: 'EDUCATION_CERTIFICATE',
              name: educationRow.studentName,
              certificateNumber: eduCertNo,
              institution: educationRow.institution_name,
              course: educationRow.course ?? null,
              issuedDate: '2026-04-02',
              annualIncome: null,
              district: null,
            } as never,
            validationStatus: 'PASSED' as never,
            validationNotes: 'Read directly from the document text layer.',
            uploadedAt: new Date(submittedAt.getTime() + 6 * 60_000),
          },
        });
      }
    }

    // Connector call history, so the admin monitoring view has real data.
    const departmentRows = await prisma.department.findMany({ select: { id: true, code: true } });
    const deptId = (code: string) => departmentRows.find((d) => d.code === code)?.id ?? null;

    for (const entry of recordPlan) {
      if (!completed.has(entry.step)) continue;
      const code = entry.type === 'LEGACY_BENEFICIARY' ? 'LEGACY' : entry.type;
      const def = DEPARTMENTS.find((d) => d.code === code)!;
      await prisma.connectorLog.create({
        data: {
          connector: code,
          departmentId: deptId(code),
          applicationId: application.id,
          endpoint:
            def.connector.connectorType === 'REST_JSON'
              ? `${def.connector.baseUrl}${def.connector.resourcePath.replace(':id', String(entry.facts?.citizenId ?? ''))}`
              : `file://${def.connector.filePath}`,
          method: def.connector.connectorType === 'REST_JSON' ? 'GET' : 'READ',
          requestStatus: 'SUCCESS' as never,
          httpStatus: def.connector.connectorType === 'REST_JSON' ? 200 : null,
          durationMs: 40 + ((seq * 17) % 180),
          createdAt: new Date(submittedAt.getTime() + 9 * 60_000),
        },
      });
    }

    if (spec.scenario === 'CONNECTOR_FAILURE') {
      const failedStep = await prisma.workflowStep.findFirstOrThrow({
        where: { workflowInstanceId: workflow.id, stepType: 'INCOME_VERIFICATION' as never },
      });
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await prisma.connectorLog.create({
          data: {
            connector: 'INCOME',
            departmentId: deptId('INCOME'),
            applicationId: application.id,
            endpoint: 'http://localhost:5001/api/income/INC-1006',
            method: 'GET',
            requestStatus: 'FAILURE' as never,
            httpStatus: 503,
            durationMs: 30 + attempt * 12,
            errorKind: 'UPSTREAM_SERVER_ERROR',
            message: 'upstream returned HTTP 503',
            createdAt: new Date(submittedAt.getTime() + (12 + attempt) * 60_000),
          },
        });
      }
      await prisma.exception.create({
        data: {
          applicationId: application.id,
          workflowStepId: failedStep.id,
          type: 'CONNECTOR_FAILURE' as never,
          severity: 'HIGH' as never,
          message:
            'Income verification could not be completed after 3 attempt(s): State Income & Revenue Department (Simulated) is not responding correctly: upstream returned HTTP 503',
          status: 'OPEN' as never,
          retryCount: 3,
          details: {
            stepType: 'INCOME_VERIFICATION',
            department: 'INCOME',
            errorKind: 'UPSTREAM_SERVER_ERROR',
            retryable: true,
            attempts: 3,
            maxAttempts: 3,
          } as never,
          createdAt: new Date(submittedAt.getTime() + 16 * 60_000),
        },
      });
    }

    // Validation report + exceptions for the scenarios that need them
    const findings: Record<string, unknown>[] = [];
    if (spec.scenario === 'MISMATCH' && serviceType === 'RATION_CARD') {
      // The duplicate-benefit check: this household already holds a record in
      // the legacy PDS register.
      findings.push({
        kind: 'ELIGIBILITY_HINT',
        severity: 'HIGH',
        field: 'beneficiaryNumber',
        message: `Applicant already appears in the legacy beneficiary register as ${legacy?.beneficiaryNumber} (status ${legacy?.verificationStatus}). Confirm this is not a duplicate claim.`,
        observed: { LEGACY: legacy?.beneficiaryNumber, STATUS: legacy?.verificationStatus },
        confidence: 1,
      });
    } else if (spec.scenario === 'MISMATCH') {
      findings.push({
        kind: 'NAME_MISMATCH',
        severity: 'LOW',
        field: 'name',
        message:
          'Possible name mismatch: EDUCATION records an abbreviated form of the name held by IDENTITY.',
        observed: { IDENTITY: identity?.name, EDUCATION: education?.name },
        confidence: 0.9,
      });
      findings.push({
        kind: 'INCOME_MISMATCH',
        severity: 'HIGH',
        field: 'annualIncome',
        message: 'Declared annual income differs by 12% between INCOME and LEGACY.',
        observed: { INCOME: income?.annualIncome, LEGACY: legacy?.annualIncome },
        confidence: 0.95,
      });
    }
    if (spec.scenario === 'SLA_OVERDUE') {
      findings.push({
        kind: 'ELIGIBILITY_HINT',
        severity: 'HIGH',
        field: 'annualIncome',
        message:
          'Declared income of 4,80,000 exceeds the scheme ceiling of 2,50,000. Officer confirmation required.',
        observed: { INCOME: 480000, CEILING: 250000 },
        confidence: 1,
      });
    }
    if (spec.scenario === 'REJECTED') {
      findings.push({
        kind: 'ELIGIBILITY_HINT',
        severity: 'HIGH',
        field: 'educationStatus',
        message:
          'Enrolment status is "INACTIVE"; the scheme requires an active enrolment. Officer confirmation required.',
        observed: { EDUCATION: 'INACTIVE' },
        confidence: 1,
      });
    }

    if (completed.has('DATA_QUALITY_CHECK')) {
      const status = findings.some((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL')
        ? 'FAILED'
        : findings.length > 0
          ? 'WARNING'
          : 'PASSED';
      await prisma.application.update({
        where: { id: application.id },
        data: {
          validationSummary: {
            status,
            engine: 'RULE_BASED',
            engineNote: 'AI service unavailable - rule-based validation used.',
            findings,
            summary:
              findings.length === 0
                ? 'All cross-department data agrees and every required document is present. No issues detected.'
                : `${findings.length} item(s) need officer attention. GovFlow does not decide eligibility - this is advisory only.`,
            generatedAt: new Date(submittedAt.getTime() + 20 * 60_000).toISOString(),
            advisoryOnly: true,
          } as never,
        },
      });

      const qualityStep = await prisma.workflowStep.findFirstOrThrow({
        where: { workflowInstanceId: workflow.id, stepType: 'DATA_QUALITY_CHECK' as never },
      });
      for (const finding of findings.filter((f) => f.severity === 'HIGH')) {
        await prisma.exception.create({
          data: {
            applicationId: application.id,
            workflowStepId: qualityStep.id,
            type: (finding.kind === 'MISSING_DOCUMENT'
              ? 'MISSING_DOCUMENT'
              : finding.kind === 'ELIGIBILITY_HINT'
                ? 'VALIDATION_FAILURE'
                : 'DATA_MISMATCH') as never,
            severity: 'HIGH' as never,
            message: String(finding.message),
            status: (spec.scenario === 'REJECTED' ? 'RESOLVED' : 'OPEN') as never,
            details: finding as never,
            resolvedAt: spec.scenario === 'REJECTED' ? application.decisionAt : null,
            resolvedById: spec.scenario === 'REJECTED' ? officerFor(service).id : null,
            resolutionNotes:
              spec.scenario === 'REJECTED'
                ? 'Confirmed against the institution. Application rejected.'
                : null,
            createdAt: new Date(submittedAt.getTime() + 21 * 60_000),
          },
        });
      }
    }

    // ---- Pre-fill snapshot + submitted form --------------------------
    //
    // Seeded so the officer console opens with a working reconciliation
    // rather than "no pre-fill recorded" on every file. The values the
    // citizen was shown come from the same connector output the workflow
    // used, so the two agree unless a scenario deliberately diverges.
    {
      const shown: Record<string, unknown> = {
        fullName: identity?.name,
        dateOfBirth: identity?.dateOfBirth,
        district: identity?.district,
        annualIncome: income?.annualIncome,
        incomeYear: income?.incomeYear,
        institution: education?.institution,
        course: education?.course,
        educationStatus: education?.educationStatus,
      };

      const sourceFor = (key: string) =>
        ['fullName', 'dateOfBirth', 'district'].includes(key)
          ? { departmentCode: 'IDENTITY', sourceSystem: 'IDENTITY_REGISTRY' }
          : ['annualIncome', 'incomeYear'].includes(key)
            ? { departmentCode: 'INCOME', sourceSystem: 'INCOME_DEPARTMENT' }
            : { departmentCode: 'EDUCATION', sourceSystem: 'EDUCATION_DEPARTMENT' };

      const schemaFields = formFields(serviceType);
      const prefillFields = schemaFields
        .filter((f) => f.source !== null)
        .map((f) => {
          const value = shown[f.key] ?? null;
          return {
            key: f.key,
            label: f.label,
            authority: f.authority,
            value: value ?? null,
            status: value === null || value === undefined ? 'NOT_HELD' : 'FILLED',
            source:
              value === null || value === undefined
                ? null
                : { ...sourceFor(f.key), fetchedAt: submittedAt.toISOString() },
          };
        });

      await prisma.prefillSnapshot.create({
        data: {
          applicationId: application.id,
          fields: prefillFields as never,
          unavailable: [],
          createdAt: submittedAt,
        },
      });

      // What the citizen actually sent. Faithful to the snapshot, except on
      // the mismatch scenario, where they revised the income downwards - the
      // one case an officer genuinely has to look at.
      const submittedValues: Record<string, unknown> = {};
      for (const field of schemaFields) {
        submittedValues[field.key] = field.source ? (shown[field.key] ?? null) : null;
      }
      if (spec.requestedAmount) submittedValues.requestedAmount = spec.requestedAmount;
      if (serviceType === 'INCOME_CERTIFICATE') {
        submittedValues.purpose = 'Educational scholarship';
      }
      if (serviceType === 'RATION_CARD') submittedValues.householdSize = 4;
      if (spec.scenario === 'MISMATCH' && income?.annualIncome) {
        submittedValues.annualIncome = Math.round((income.annualIncome as number) * 0.55);
      }

      await prisma.application.update({
        where: { id: application.id },
        data: { submittedValues: submittedValues as never },
      });
    }

    // A couple of officer notes for texture
    if (spec.scenario === 'MISMATCH') {
      await prisma.reviewNote.create({
        data: {
          applicationId: application.id,
          authorId: officerFor(service).id,
          note: 'Requested the institution to confirm the full name on record. The abbreviation looks like a data-entry convention rather than a different person.',
          createdAt: hoursAgo(20),
        },
      });
    }
    if (spec.scenario === 'APPROVED_CLEAN') {
      await prisma.reviewNote.create({
        data: {
          applicationId: application.id,
          authorId: officerFor(service).id,
          note: 'All three registries agree. Income well within the ceiling. Approving.',
          createdAt: hoursAgo(30),
        },
      });
    }

    // Citizen-facing notifications
    await prisma.notification.create({
      data: {
        userId: citizen.userId,
        applicationId: application.id,
        type: 'SUCCESS' as never,
        title: 'Application submitted successfully',
        message: `Application ${application.applicationNumber} has been received.`,
        readAt: spec.submittedDaysAgo > 2 ? hoursAgo(40) : null,
        createdAt: submittedAt,
      },
    });
    if (plan.decided === 'APPROVE') {
      await prisma.notification.create({
        data: {
          userId: citizen.userId,
          applicationId: application.id,
          type: 'SUCCESS' as never,
          title: 'Your application has been approved',
          message: `Application ${application.applicationNumber} has been approved by a review officer.`,
          createdAt: application.decisionAt!,
        },
      });
    }
    if (plan.decided === 'REJECT') {
      await prisma.notification.create({
        data: {
          userId: citizen.userId,
          applicationId: application.id,
          type: 'ERROR' as never,
          title: 'Your application has been rejected',
          message: `Application ${application.applicationNumber} has been rejected.`,
          createdAt: application.decisionAt!,
        },
      });
    }
    if (spec.scenario === 'MISSING_DOCUMENT') {
      await prisma.notification.create({
        data: {
          userId: citizen.userId,
          applicationId: application.id,
          type: 'WARNING' as never,
          title: 'Document required',
          message:
            'Your application cannot proceed until you upload: income certificate.',
          createdAt: new Date(submittedAt.getTime() + 12 * 60_000),
        },
      });
    }
    if (spec.scenario === 'CONNECTOR_FAILURE') {
      await prisma.notification.create({
        data: {
          userId: citizen.userId,
          applicationId: application.id,
          type: 'WARNING' as never,
          title: 'Your application is delayed',
          message:
            'State Income & Revenue Department (Simulated) is currently unavailable, so income verification could not be completed. An officer has been notified.',
          createdAt: new Date(submittedAt.getTime() + 17 * 60_000),
        },
      });
      await prisma.notification.create({
        data: {
          userId: officerFor(service).id,
          applicationId: application.id,
          type: 'ERROR' as never,
          title: `Exception on ${application.applicationNumber}`,
          message: 'Income verification could not be completed after 3 attempts.',
          createdAt: new Date(submittedAt.getTime() + 17 * 60_000),
        },
      });
    }

    // Audit trail
    const auditEvents: { action: string; userId: string | null; at: Date; metadata: Record<string, unknown> }[] = [
      { action: 'APPLICATION_CREATED', userId: citizen.userId, at: submittedAt, metadata: { applicationNumber: application.applicationNumber } },
      { action: 'WORKFLOW_STARTED', userId: null, at: new Date(submittedAt.getTime() + 60_000), metadata: { applicationId: application.id } },
    ];
    for (const scope of consentScopes) {
      auditEvents.push({
        action: 'CONSENT_GRANTED',
        userId: citizen.userId,
        at: new Date(submittedAt.getTime() + 2 * 60_000),
        metadata: { applicationId: application.id, department: scope.code },
      });
    }
    for (const entry of recordPlan) {
      if (!completed.has(entry.step)) continue;
      auditEvents.push({
        action: 'DATA_ACCESSED',
        userId: null,
        at: new Date(submittedAt.getTime() + 10 * 60_000),
        metadata: {
          applicationId: application.id,
          department: entry.type === 'LEGACY_BENEFICIARY' ? 'LEGACY' : entry.type,
          sourceSystem: entry.source,
          mapping: entry.mapping,
        },
      });
    }
    if (plan.decided) {
      auditEvents.push({
        action: plan.decided === 'APPROVE' ? 'OFFICER_APPROVED' : 'OFFICER_REJECTED',
        userId: officerFor(service).id,
        at: application.decisionAt!,
        metadata: { applicationId: application.id, applicationNumber: application.applicationNumber },
      });
    }
    for (const event of auditEvents) {
      await prisma.auditLog.create({
        data: {
          action: event.action,
          resourceType: 'Application',
          resourceId: application.id,
          userId: event.userId,
          metadata: event.metadata as never,
          createdAt: event.at,
        },
      });
    }

    console.log(
      `[seed] ${application.applicationNumber}  ${spec.citizenId.padEnd(9)} ${spec.scenario}`,
    );
  }

  // Login history so the audit page is not empty on first open
  for (const u of [officer.id, officer2.id, admin.id]) {
    await prisma.auditLog.create({
      data: {
        action: 'USER_LOGIN',
        resourceType: 'User',
        resourceId: u,
        userId: u,
        metadata: { seeded: true } as never,
        createdAt: hoursAgo(2),
      },
    });
  }

  // Certificates for the live-demo citizen (CIT-1001) who has no application yet.
  const rohan = IDENTITY.find((r) => r.citizenId === 'CIT-1001')!;
  const rohanEdu = EDUCATION.find((r) => r.student_no === 'STU-1001')!;
  writeDoc(
    'income-certificate-CIT-1001.txt',
    incomeCertificate(rohan.fullName, rohan.district, 180000, 'INC/2026/44821'),
  );
  writeDoc(
    'education-certificate-CIT-1001.txt',
    educationCertificate(
      rohanEdu.studentName,
      rohanEdu.institution_name,
      rohanEdu.course!,
      'EDU/2026/9101',
    ),
  );

  const counts = {
    departments: await prisma.department.count(),
    citizens: await prisma.citizen.count(),
    users: await prisma.user.count(),
    applications: await prisma.application.count(),
    normalizedRecords: await prisma.normalizedRecord.count(),
    documents: await prisma.document.count(),
    exceptions: await prisma.exception.count(),
    connectorLogs: await prisma.connectorLog.count(),
    auditLogs: await prisma.auditLog.count(),
    notifications: await prisma.notification.count(),
  };
  console.log('[seed] done', counts);
  console.log(
    `[seed] demo password for every account: ${DEMO_PASSWORD}\n` +
      '[seed]   citizen : rohan.prajapati@example.gov.in  (no application yet - use for the live demo)\n' +
      '[seed]   officer : officer@govflow.gov.in   (Education - scholarships)\n' +
      '[seed]   officer : officer2@govflow.gov.in  (Revenue - income certificates, ration cards)\n' +
      '[seed]   admin   : admin@govflow.gov.in',
  );
}

main()
  .catch((error) => {
    console.error('[seed] failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
