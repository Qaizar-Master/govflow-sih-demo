import {
  ApplicationStatus,
  AuditAction,
  ConsentStatus,
  NotificationType,
  Role,
  formFields,
  getServiceDefinition,
  type ServiceType,
} from '@govflow/contracts';
import { prisma } from './db.js';
import { recordAudit } from './audit.js';
import { notifyApplicant } from './notifications.js';
import { createLogger } from './logger.js';
import { startWorkflow } from './workflow/engine.js';

const log = createLogger('drafts');

/**
 * THE DRAFT LIFECYCLE
 * ---------------------------------------------------------------------------
 * Pre-fill needs somewhere to happen. A form cannot be answered from the
 * registries before an application exists to hang consent off, and consent
 * cannot be recorded against nothing - so the citizen's first act is to open a
 * draft, not to submit one.
 *
 * A draft is deliberately inert. No workflow runs, no officer sees it, no SLA
 * clock starts. It exists to hold two things: the consent ledger that
 * authorises pre-fill, and the snapshot of what pre-fill returned.
 */

const APPLICATION_PREFIX: Record<string, string> = {
  SCHOLARSHIP: 'GF-SCH',
  INCOME_CERTIFICATE: 'GF-INC',
  RATION_CARD: 'GF-PDS',
};

async function nextApplicationNumber(serviceType: string): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.application.count();
  const prefix = APPLICATION_PREFIX[serviceType] ?? 'GF-APP';
  return `${prefix}-${year}-${String(count + 1).padStart(5, '0')}`;
}

export interface CreateDraftInput {
  citizenId: string;
  serviceType: ServiceType;
  actorUserId?: string | null;
}

/**
 * Opens a draft and its consent ledger. Contacts nobody: the consent rows
 * start PENDING, and pre-fill will refuse to query a department until the
 * citizen grants the matching scope.
 */
export async function createDraftApplication(input: CreateDraftInput) {
  const citizen = await prisma.citizen.findUnique({ where: { id: input.citizenId } });
  if (!citizen) throw new Error(`Citizen ${input.citizenId} not found`);

  const service = getServiceDefinition(input.serviceType);

  let application;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      application = await prisma.application.create({
        data: {
          applicationNumber: await nextApplicationNumber(service.serviceType),
          citizenId: citizen.id,
          serviceType: service.serviceType as never,
          status: ApplicationStatus.DRAFT as never,
          slaTargetDays: service.slaTargetDays,
          consents: {
            create: service.consentScopes.map((scope) => ({
              citizenId: citizen.id,
              departmentCode: scope.departmentCode,
              purpose: scope.purpose,
              status: ConsentStatus.PENDING as never,
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
      draft: true,
    },
  });

  log.info('draft opened', { id: application.id, number: application.applicationNumber });

  return prisma.application.findUniqueOrThrow({
    where: { id: application.id },
    include: { consents: true },
  });
}

export interface SubmitDraftInput {
  applicationId: string;
  /** Form values keyed by the service's form-schema field keys. */
  values: Record<string, string | number | null>;
  actorUserId?: string | null;
}

export class DraftValidationError extends Error {
  readonly fieldErrors: Record<string, string>;
  constructor(fieldErrors: Record<string, string>) {
    super('Some answers are missing or invalid');
    this.name = 'DraftValidationError';
    this.fieldErrors = fieldErrors;
  }
}

/**
 * Validates the answered form against the service's schema, records exactly
 * what was submitted, and releases the workflow.
 *
 * The submitted values are stored verbatim rather than merged into the
 * registry view. That separation is what makes reconciliation possible: an
 * answer the citizen changed has to stay visibly theirs.
 */
export async function submitDraftApplication(input: SubmitDraftInput) {
  const application = await prisma.application.findUnique({
    where: { id: input.applicationId },
    select: { id: true, applicationNumber: true, serviceType: true, status: true },
  });
  if (!application) throw new Error('Application not found');
  if (application.status !== ApplicationStatus.DRAFT) {
    throw new Error('This application has already been submitted');
  }

  const fields = formFields(application.serviceType);
  const fieldErrors: Record<string, string> = {};
  const values: Record<string, string | number | null> = {};

  for (const field of fields) {
    const raw = input.values[field.key];
    const missing = raw === undefined || raw === null || String(raw).trim() === '';

    if (missing) {
      if (field.required) fieldErrors[field.key] = `${field.label} is required`;
      values[field.key] = null;
      continue;
    }

    if (field.type === 'number') {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        fieldErrors[field.key] = `${field.label} must be a number`;
        continue;
      }
      if (parsed < 0) {
        fieldErrors[field.key] = `${field.label} cannot be negative`;
        continue;
      }
      values[field.key] = parsed;
      continue;
    }

    if (field.type === 'select' && field.options && !field.options.includes(String(raw))) {
      fieldErrors[field.key] = `${field.label} is not one of the accepted options`;
      continue;
    }

    values[field.key] = String(raw).trim();
  }

  if (Object.keys(fieldErrors).length > 0) throw new DraftValidationError(fieldErrors);

  // requestedAmount and institutionClaim predate the form schema and are read
  // by the validation engine and the officer list, so they are kept in step.
  const requestedAmount =
    typeof values.requestedAmount === 'number' ? values.requestedAmount : null;
  const institutionClaim =
    typeof values.institution === 'string' ? values.institution : null;

  const updated = await prisma.application.update({
    where: { id: application.id },
    data: {
      status: ApplicationStatus.SUBMITTED as never,
      submittedValues: values as never,
      submittedAt: new Date(),
      requestedAmount,
      institutionClaim,
    },
  });

  await recordAudit({
    action: AuditAction.APPLICATION_SUBMITTED,
    resourceType: 'Application',
    resourceId: application.id,
    userId: input.actorUserId ?? null,
    actorRole: Role.CITIZEN,
    // Which fields were answered, never the answers themselves.
    metadata: {
      applicationNumber: application.applicationNumber,
      fieldsAnswered: Object.keys(values).filter((k) => values[k] !== null).length,
    },
  });

  await notifyApplicant(
    application.id,
    'Application submitted successfully',
    `Application ${application.applicationNumber} has been received. Cross-department verification will begin once all consents are granted.`,
    NotificationType.SUCCESS,
  );

  await startWorkflow(application.id);

  log.info('draft submitted', { id: application.id, number: application.applicationNumber });
  return updated;
}
