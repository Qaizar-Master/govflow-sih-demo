import {
  ApplicationStatus,
  AuditAction,
  ConsentStatus,
  DEPARTMENTS,
  NotificationType,
  Role,
  SCHOLARSHIP_WORKFLOW,
  ServiceType,
  StepStatus,
  workflowConfig,
  type SlaAssessment,
} from '@govflow/contracts';
import { prisma } from './db.js';
import { recordAudit } from './audit.js';
import { notifyApplicant } from './notifications.js';
import { assessSla } from './sla.js';
import { createLogger } from './logger.js';
import { resumeWorkflow, startWorkflow } from './workflow/engine.js';
import { assembleFacts } from './workflow/facts.js';

const log = createLogger('applications');

/** Consent scopes a scholarship application needs, with a stated purpose. */
export const CONSENT_SCOPES = [
  {
    departmentCode: 'IDENTITY',
    purpose: 'Verify the applicant’s identity, date of birth and district of residence.',
  },
  {
    departmentCode: 'INCOME',
    purpose: 'Confirm declared annual family income against the income registry.',
  },
  {
    departmentCode: 'EDUCATION',
    purpose: 'Confirm active enrolment and institution details.',
  },
] as const;

async function nextApplicationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.application.count();
  return `GF-SCH-${year}-${String(count + 1).padStart(5, '0')}`;
}

export interface CreateApplicationInput {
  citizenId: string;
  serviceType?: ServiceType;
  requestedAmount?: number | null;
  institutionClaim?: string | null;
  /** Department codes the citizen consented to during submission. */
  grantedConsents?: string[];
  actorUserId?: string | null;
}

/**
 * Creates an application, records the consent ledger, and hands the workflow to
 * the queue. The HTTP caller returns immediately with PROCESSING - no
 * department is contacted on the request thread.
 */
export async function createApplication(input: CreateApplicationInput) {
  const citizen = await prisma.citizen.findUnique({ where: { id: input.citizenId } });
  if (!citizen) throw new Error(`Citizen ${input.citizenId} not found`);

  const granted = new Set((input.grantedConsents ?? []).map((c) => c.toUpperCase()));

  // Retry once on the (unlikely) concurrent-submission number collision.
  let application;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      application = await prisma.application.create({
        data: {
          applicationNumber: await nextApplicationNumber(),
          citizenId: citizen.id,
          serviceType: (input.serviceType ?? ServiceType.SCHOLARSHIP) as never,
          status: ApplicationStatus.SUBMITTED as never,
          requestedAmount: input.requestedAmount ?? null,
          institutionClaim: input.institutionClaim ?? null,
          slaTargetDays: workflowConfig.slaTargetDays,
          consents: {
            create: CONSENT_SCOPES.map((scope) => ({
              citizenId: citizen.id,
              departmentCode: scope.departmentCode,
              purpose: scope.purpose,
              status: (granted.has(scope.departmentCode)
                ? ConsentStatus.GRANTED
                : ConsentStatus.PENDING) as never,
              grantedAt: granted.has(scope.departmentCode) ? new Date() : null,
              expiresAt: new Date(Date.now() + 90 * 24 * 3_600_000),
            })),
          },
        },
      });
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  if (!application) throw new Error('Could not allocate an application number');

  await recordAudit({
    action: AuditAction.APPLICATION_CREATED,
    resourceType: 'Application',
    resourceId: application.id,
    userId: input.actorUserId ?? null,
    actorRole: Role.CITIZEN,
    metadata: {
      applicationNumber: application.applicationNumber,
      serviceType: application.serviceType,
      consentsGrantedAtSubmission: [...granted],
    },
  });
  for (const scope of CONSENT_SCOPES) {
    await recordAudit({
      action: granted.has(scope.departmentCode)
        ? AuditAction.CONSENT_GRANTED
        : AuditAction.CONSENT_REQUESTED,
      resourceType: 'Consent',
      resourceId: `${application.applicationNumber}:${scope.departmentCode}`,
      userId: input.actorUserId ?? null,
      metadata: { department: scope.departmentCode, purpose: scope.purpose },
    });
  }

  await notifyApplicant(
    application.id,
    'Application submitted successfully',
    `Application ${application.applicationNumber} has been received. Cross-department verification will begin once all consents are granted.`,
    NotificationType.SUCCESS,
  );

  await startWorkflow(application.id);

  log.info('application created', {
    id: application.id,
    number: application.applicationNumber,
  });

  return prisma.application.findUniqueOrThrow({
    where: { id: application.id },
    include: { consents: true, workflow: { include: { steps: true } } },
  });
}

export interface GrantConsentInput {
  applicationId: string;
  departmentCode: string;
  granted: boolean;
  actorUserId?: string | null;
}

/**
 * Records a consent decision. Granting the last outstanding scope releases the
 * parked workflow, which is what makes the consent gate demonstrable.
 */
export async function setConsent(input: GrantConsentInput) {
  const code = input.departmentCode.toUpperCase();
  if (!CONSENT_SCOPES.some((s) => s.departmentCode === code)) {
    throw new Error(`Unknown consent scope: ${code}`);
  }

  const existing = await prisma.consent.findUnique({
    where: {
      applicationId_departmentCode: { applicationId: input.applicationId, departmentCode: code },
    },
  });
  if (!existing) throw new Error(`No consent record for ${code} on this application`);

  const consent = await prisma.consent.update({
    where: { id: existing.id },
    data: {
      status: (input.granted ? ConsentStatus.GRANTED : ConsentStatus.DENIED) as never,
      grantedAt: input.granted ? new Date() : null,
      revokedAt: input.granted ? null : new Date(),
    },
  });

  await recordAudit({
    action: input.granted ? AuditAction.CONSENT_GRANTED : AuditAction.CONSENT_DENIED,
    resourceType: 'Consent',
    resourceId: consent.id,
    userId: input.actorUserId ?? null,
    actorRole: Role.CITIZEN,
    metadata: { applicationId: input.applicationId, department: code },
  });

  const outstanding = await prisma.consent.count({
    where: { applicationId: input.applicationId, status: { not: ConsentStatus.GRANTED as never } },
  });

  if (outstanding === 0) {
    await resumeWorkflow(input.applicationId, { userId: input.actorUserId ?? null });
    await notifyApplicant(
      input.applicationId,
      'Consent complete - verification started',
      'All consents are recorded. GovFlow has begun contacting the relevant departments.',
      NotificationType.INFO,
    );
  }

  return { consent, outstanding };
}

export async function revokeConsent(input: Omit<GrantConsentInput, 'granted'>) {
  const code = input.departmentCode.toUpperCase();
  const consent = await prisma.consent.update({
    where: {
      applicationId_departmentCode: { applicationId: input.applicationId, departmentCode: code },
    },
    data: { status: ConsentStatus.REVOKED as never, revokedAt: new Date() },
  });
  await recordAudit({
    action: AuditAction.CONSENT_REVOKED,
    resourceType: 'Consent',
    resourceId: consent.id,
    userId: input.actorUserId ?? null,
    actorRole: Role.CITIZEN,
    metadata: { applicationId: input.applicationId, department: code },
  });
  return consent;
}

// ===========================================================================
// Read models
// ===========================================================================

export interface TimelineEntry {
  stepType: string;
  label: string;
  order: number;
  status: string;
  department: string | null;
  departmentName: string | null;
  automated: boolean;
  description: string;
  retryCount: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  output: unknown;
}

export async function getTimeline(applicationId: string): Promise<TimelineEntry[]> {
  const workflow = await prisma.workflowInstance.findUnique({
    where: { applicationId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
  if (!workflow) return [];

  return workflow.steps.map((step) => {
    const def = SCHOLARSHIP_WORKFLOW.find((d) => d.stepType === step.stepType);
    const department = step.department
      ? DEPARTMENTS.find((d) => d.code === step.department)
      : undefined;
    return {
      stepType: step.stepType,
      label: step.label,
      order: step.order,
      status: step.status,
      department: step.department,
      departmentName: department?.name ?? null,
      automated: def?.automated ?? true,
      description: def?.description ?? '',
      retryCount: step.retryCount,
      maxAttempts: step.maxAttempts,
      startedAt: step.startedAt?.toISOString() ?? null,
      completedAt: step.completedAt?.toISOString() ?? null,
      errorMessage: step.errorMessage,
      output: step.output,
    };
  });
}

export async function slaFor(applicationId: string): Promise<SlaAssessment> {
  const application = await prisma.application.findUniqueOrThrow({
    where: { id: applicationId },
    select: {
      submittedAt: true,
      slaTargetDays: true,
      decisionAt: true,
      status: true,
      _count: { select: { exceptions: { where: { status: 'OPEN' } } } },
    },
  });
  return assessSla({
    submittedAt: application.submittedAt,
    targetDays: application.slaTargetDays,
    decidedAt: application.decisionAt,
    hasOpenException: application._count.exceptions > 0,
    isWaitingOnOfficer:
      application.status === ApplicationStatus.UNDER_REVIEW ||
      application.status === ApplicationStatus.REQUIRES_REVIEW,
  });
}

/** Everything the officer detail page and citizen detail page both need. */
export async function getApplicationDetail(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      citizen: true,
      consents: { orderBy: { departmentCode: 'asc' } },
      documents: { orderBy: { uploadedAt: 'asc' } },
      exceptions: { orderBy: { createdAt: 'desc' } },
      reviewNotes: {
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { id: true, name: true, role: true } } },
      },
      decidedBy: { select: { id: true, name: true } },
      normalizedRecords: { orderBy: { receivedAt: 'asc' } },
    },
  });
  if (!application) return null;

  const [timeline, sla, facts, auditTrail] = await Promise.all([
    getTimeline(applicationId),
    slaFor(applicationId),
    assembleFacts(applicationId),
    prisma.auditLog.findMany({
      where: {
        OR: [
          { resourceType: 'Application', resourceId: applicationId },
          { metadata: { path: ['applicationId'], equals: applicationId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: { user: { select: { name: true, role: true } } },
    }),
  ]);

  const stepsPending = timeline.filter(
    (t) => t.status === StepStatus.PENDING || t.status === StepStatus.IN_PROGRESS,
  ).length;

  return {
    application: {
      id: application.id,
      applicationNumber: application.applicationNumber,
      serviceType: application.serviceType,
      status: application.status,
      currentStep: application.currentStep,
      requestedAmount: application.requestedAmount,
      institutionClaim: application.institutionClaim,
      submittedAt: application.submittedAt.toISOString(),
      decisionAt: application.decisionAt?.toISOString() ?? null,
      decisionNotes: application.decisionNotes,
      decidedBy: application.decidedBy,
      slaTargetDays: application.slaTargetDays,
      validationSummary: application.validationSummary,
      stepsPending,
    },
    citizen: {
      id: application.citizen.id,
      externalId: application.citizen.externalId,
      name: application.citizen.name,
      dateOfBirth: application.citizen.dateOfBirth.toISOString().slice(0, 10),
      district: application.citizen.district,
      email: application.citizen.email,
      phone: application.citizen.phone,
    },
    consents: application.consents.map((c) => ({
      id: c.id,
      departmentCode: c.departmentCode,
      departmentName: DEPARTMENTS.find((d) => d.code === c.departmentCode)?.name ?? c.departmentCode,
      purpose: c.purpose,
      status: c.status,
      grantedAt: c.grantedAt?.toISOString() ?? null,
      expiresAt: c.expiresAt?.toISOString() ?? null,
    })),
    documents: application.documents.map((d) => ({
      id: d.id,
      documentType: d.documentType,
      fileName: d.fileName,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      extractionStatus: d.extractionStatus,
      extractedData: d.extractedData,
      validationStatus: d.validationStatus,
      validationNotes: d.validationNotes,
      extractionEngine: d.extractionEngine,
      uploadedAt: d.uploadedAt.toISOString(),
    })),
    exceptions: application.exceptions.map((e) => ({
      id: e.id,
      type: e.type,
      severity: e.severity,
      message: e.message,
      status: e.status,
      retryCount: e.retryCount,
      details: e.details,
      createdAt: e.createdAt.toISOString(),
      resolvedAt: e.resolvedAt?.toISOString() ?? null,
      resolutionNotes: e.resolutionNotes,
    })),
    reviewNotes: application.reviewNotes.map((n) => ({
      id: n.id,
      note: n.note,
      author: n.author,
      createdAt: n.createdAt.toISOString(),
    })),
    verification: {
      identity: facts.identity,
      income: facts.income,
      education: facts.education,
      legacy: facts.legacy,
      consolidated: facts.consolidated,
      receivedAt: facts.receivedAt,
      sources: application.normalizedRecords.map((r) => ({
        sourceSystem: r.sourceSystem,
        sourceRecordId: r.sourceRecordId,
        dataType: r.dataType,
        mappingName: r.mappingName,
        validationStatus: r.validationStatus,
        qualityWarnings: r.qualityWarnings,
        receivedAt: r.receivedAt.toISOString(),
      })),
    },
    timeline,
    sla,
    auditTrail: auditTrail.map((a) => ({
      id: a.id,
      action: a.action,
      resourceType: a.resourceType,
      resourceId: a.resourceId,
      actor: a.user?.name ?? 'system',
      actorRole: a.actorRole ?? a.user?.role ?? null,
      metadata: a.metadata,
      createdAt: a.createdAt.toISOString(),
    })),
  };
}

export interface ListApplicationsFilter {
  citizenId?: string;
  statuses?: ApplicationStatus[];
  search?: string;
  page?: number;
  pageSize?: number;
}

export async function listApplications(filter: ListApplicationsFilter = {}) {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));

  const where = {
    ...(filter.citizenId ? { citizenId: filter.citizenId } : {}),
    ...(filter.statuses?.length ? { status: { in: filter.statuses as never } } : {}),
    ...(filter.search
      ? {
          OR: [
            { applicationNumber: { contains: filter.search, mode: 'insensitive' as const } },
            { citizen: { name: { contains: filter.search, mode: 'insensitive' as const } } },
            { citizen: { externalId: { contains: filter.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: { submittedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        citizen: { select: { name: true, externalId: true, district: true } },
        workflow: { select: { status: true, currentStep: true } },
        _count: {
          select: {
            exceptions: { where: { status: 'OPEN' } },
            documents: true,
          },
        },
      },
    }),
    prisma.application.count({ where }),
  ]);

  const items = rows.map((row) => {
    const summary = row.validationSummary as { status?: string; findings?: unknown[] } | null;
    return {
      id: row.id,
      applicationNumber: row.applicationNumber,
      serviceType: row.serviceType,
      status: row.status,
      currentStep: row.currentStep,
      workflowStatus: row.workflow?.status ?? null,
      citizenName: row.citizen.name,
      citizenExternalId: row.citizen.externalId,
      district: row.citizen.district,
      submittedAt: row.submittedAt.toISOString(),
      decisionAt: row.decisionAt?.toISOString() ?? null,
      openExceptions: row._count.exceptions,
      documentCount: row._count.documents,
      validationStatus: summary?.status ?? null,
      findingCount: summary?.findings?.length ?? 0,
      sla: assessSla({
        submittedAt: row.submittedAt,
        targetDays: row.slaTargetDays,
        decidedAt: row.decisionAt,
        hasOpenException: row._count.exceptions > 0,
        isWaitingOnOfficer:
          row.status === ApplicationStatus.UNDER_REVIEW ||
          row.status === ApplicationStatus.REQUIRES_REVIEW,
      }),
    };
  });

  return { items, total, page, pageSize };
}

export async function addReviewNote(applicationId: string, authorId: string, note: string) {
  const created = await prisma.reviewNote.create({
    data: { applicationId, authorId, note },
    include: { author: { select: { id: true, name: true, role: true } } },
  });
  await recordAudit({
    action: AuditAction.OFFICER_NOTE_ADDED,
    resourceType: 'Application',
    resourceId: applicationId,
    userId: authorId,
    actorRole: Role.OFFICER,
    metadata: { noteId: created.id, applicationId },
  });
  return created;
}
