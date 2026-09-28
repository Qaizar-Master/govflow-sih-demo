import {
  ApplicationStatus,
  AuditAction,
  ConsentStatus,
  DeliveryStatus,
  ExceptionStatus,
  ExceptionType,
  FINDING_KIND,
  JOB_NAMES,
  NotificationType,
  Role,
  getServiceDefinition,
  Severity,
  StepStatus,
  StepType,
  ValidationStatus,
  WorkflowStatus,
  getDepartmentDefinition,
  workflowConfig,
  type ValidationFinding,
  type WorkflowStepDefinition,
} from '@govflow/contracts';
import { isConnectorError } from '@govflow/connector-sdk';
import { prisma } from '../db.js';
import { recordAudit } from '../audit.js';
import { raiseException } from '../exceptions.js';
import { notifyApplicant, notifyRole } from '../notifications.js';
import { getConnector } from '../connector-registry.js';
import { resolveDepartmentIdentifier } from '../identity/crosswalk.js';
import { produceValidationReport } from '../validation/index.js';
import { classifyDocument, documentProcessor } from '../documents/index.js';
import { enqueueStep } from '../queue.js';
import { createLogger } from '../logger.js';
import { assembleFacts, unavailableSources } from './facts.js';

const log = createLogger('workflow');

/** Which BullMQ job name carries each step. */
export function jobNameForStep(stepType: StepType): string {
  switch (stepType) {
    case StepType.IDENTITY_VERIFICATION:
      return JOB_NAMES.IDENTITY_VERIFICATION;
    case StepType.INCOME_VERIFICATION:
      return JOB_NAMES.INCOME_VERIFICATION;
    case StepType.EDUCATION_VERIFICATION:
      return JOB_NAMES.EDUCATION_VERIFICATION;
    case StepType.LEGACY_CROSS_CHECK:
      return JOB_NAMES.LEGACY_CROSS_CHECK;
    case StepType.DOCUMENT_VALIDATION:
      return JOB_NAMES.DOCUMENT_VALIDATION;
    case StepType.DATA_QUALITY_CHECK:
      return JOB_NAMES.DATA_QUALITY_CHECK;
    case StepType.DEPARTMENT_WRITE_BACK:
      return JOB_NAMES.DEPARTMENT_WRITE_BACK;
    default:
      return JOB_NAMES.RUN_STEP;
  }
}

function definitionFor(serviceType: string, stepType: StepType): WorkflowStepDefinition {
  const def = getServiceDefinition(serviceType).steps.find((s) => s.stepType === stepType);
  if (!def) throw new Error(`Service ${serviceType} has no step ${stepType}`);
  return def;
}

function nextDefinition(serviceType: string, stepType: StepType): WorkflowStepDefinition | null {
  const steps = getServiceDefinition(serviceType).steps;
  const current = definitionFor(serviceType, stepType);
  return steps.find((s) => s.order === current.order + 1) ?? null;
}

/** The departments a service consults, so validation only expects those. */
function expectedSources(serviceType: string): string[] {
  return getServiceDefinition(serviceType)
    .steps.map((s) => s.departmentCode)
    .filter((c): c is string => c !== null && c !== 'LEGACY');
}

// ===========================================================================
// Workflow lifecycle
// ===========================================================================

/**
 * Materialises the workflow instance and every step row up front, then hands
 * the first step to the queue. Persisting all steps immediately is what lets
 * the citizen timeline show future steps as PENDING instead of guessing.
 */
export async function startWorkflow(applicationId: string) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, applicationNumber: true, serviceType: true },
  });
  if (!application) throw new Error(`Application ${applicationId} not found`);

  // The service definition decides which steps exist for this application.
  const service = getServiceDefinition(application.serviceType);
  const steps = service.steps;

  const instance = await prisma.workflowInstance.upsert({
    where: { applicationId },
    create: {
      applicationId,
      definitionName: `${application.serviceType.toLowerCase()}-v1`,
      status: WorkflowStatus.RUNNING as never,
      currentStep: steps[0]!.stepType as never,
    },
    update: { status: WorkflowStatus.RUNNING as never },
  });

  for (const def of steps) {
    await prisma.workflowStep.upsert({
      where: {
        workflowInstanceId_stepType: {
          workflowInstanceId: instance.id,
          stepType: def.stepType as never,
        },
      },
      create: {
        workflowInstanceId: instance.id,
        stepType: def.stepType as never,
        order: def.order,
        label: def.label,
        department: def.departmentCode,
        status: StepStatus.PENDING as never,
        maxAttempts: workflowConfig.maxAttempts,
      },
      update: {},
    });
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: ApplicationStatus.PROCESSING as never,
      currentStep: steps[0]!.stepType as never,
    },
  });

  await recordAudit({
    action: AuditAction.WORKFLOW_STARTED,
    resourceType: 'WorkflowInstance',
    resourceId: instance.id,
    metadata: {
      applicationId,
      applicationNumber: application.applicationNumber,
      serviceType: application.serviceType,
      steps: steps.length,
    },
  });

  await enqueueStep(JOB_NAMES.APPLICATION_CREATED, {
    applicationId,
    workflowInstanceId: instance.id,
    stepType: steps[0]!.stepType,
  });

  return instance;
}

export interface RunStepInput {
  applicationId: string;
  stepType: StepType;
  /** 1-based attempt number supplied by BullMQ. */
  attempt: number;
  maxAttempts: number;
}

export type StepOutcome =
  | { result: 'COMPLETED'; nextStep: StepType | null }
  | { result: 'WAITING_FOR_CITIZEN'; reason: string }
  | { result: 'WAITING_FOR_OFFICER' }
  | { result: 'RETRY'; error: Error }
  | { result: 'EXHAUSTED'; message: string };

/**
 * Executes exactly one workflow step and persists the outcome.
 *
 * Retry policy: a retryable connector failure re-throws so BullMQ can back off
 * and try again; the final attempt instead records the failure, raises an
 * exception and notifies officers, so a dead department parks the application
 * for a human rather than poisoning the queue.
 */
export async function runStep(input: RunStepInput): Promise<StepOutcome> {
  const { applicationId, stepType, attempt, maxAttempts } = input;

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: {
      citizen: true,
      workflow: { include: { steps: true } },
      documents: true,
      consents: true,
    },
  });
  if (!application?.workflow) {
    throw new Error(`No workflow instance for application ${applicationId}`);
  }

  const step = application.workflow.steps.find((s) => s.stepType === stepType);
  if (!step) throw new Error(`Step ${stepType} not present on ${applicationId}`);

  // A decided application runs no further *verification*: a stray queued job
  // must not re-open a file an officer has closed.
  //
  // Write-back is the deliberate exception, and the only one. Its entire
  // purpose is to run after the decision - it is how the decision leaves
  // GovFlow - so excluding it here would silently strand every approval in
  // the one place it must not stop.
  if (
    stepType !== StepType.DEPARTMENT_WRITE_BACK &&
    (application.status === ApplicationStatus.APPROVED ||
      application.status === ApplicationStatus.REJECTED)
  ) {
    return { result: 'COMPLETED', nextStep: null };
  }

  await prisma.workflowStep.update({
    where: { id: step.id },
    data: {
      status: (attempt > 1 ? StepStatus.RETRYING : StepStatus.IN_PROGRESS) as never,
      startedAt: step.startedAt ?? new Date(),
      retryCount: attempt - 1,
      errorMessage: null,
    },
  });
  await prisma.workflowInstance.update({
    where: { id: application.workflow.id },
    data: { status: WorkflowStatus.RUNNING as never, currentStep: stepType as never },
  });
  await prisma.application.update({
    where: { id: applicationId },
    data: { currentStep: stepType as never },
  });

  await recordAudit({
    action: AuditAction.WORKFLOW_STEP_STARTED,
    resourceType: 'WorkflowStep',
    resourceId: step.id,
    metadata: { applicationId, stepType, attempt },
  });

  try {
    const handled = await dispatchStep(stepType, {
      applicationId,
      stepId: step.id,
      citizenId: application.citizen.id,
      citizenExternalId: application.citizen.externalId,
      applicationNumber: application.applicationNumber,
      serviceType: application.serviceType,
    });

    if (handled.kind === 'WAITING_FOR_CITIZEN') {
      await parkForCitizen({
        applicationId,
        workflowInstanceId: application.workflow.id,
        stepId: step.id,
        stepType,
        reason: handled.reason,
      });
      return { result: 'WAITING_FOR_CITIZEN', reason: handled.reason };
    }

    await prisma.workflowStep.update({
      where: { id: step.id },
      data: {
        status: StepStatus.COMPLETED as never,
        completedAt: new Date(),
        output: (handled.output ?? undefined) as never,
        errorMessage: handled.warning ?? null,
      },
    });

    await recordAudit({
      action: AuditAction.WORKFLOW_STEP_COMPLETED,
      resourceType: 'WorkflowStep',
      resourceId: step.id,
      metadata: { applicationId, stepType, attempt },
    });

    return await advance(applicationId, application.serviceType, application.workflow.id, stepType);
  } catch (error) {
    return await handleStepFailure({
      applicationId,
      applicationNumber: application.applicationNumber,
      serviceType: application.serviceType,
      workflowInstanceId: application.workflow.id,
      stepId: step.id,
      stepType,
      attempt,
      maxAttempts,
      error,
    });
  }
}


/**
 * Parks an application on the citizen.
 *
 * The distinction from REQUIRES_REVIEW matters: an officer opening a file that
 * is missing a document the citizen must supply has nothing to decide, so the
 * application must not enter their queue at all. Real government workflows call
 * this a deficiency memo - the file goes back, not forward.
 */
async function parkForCitizen(input: {
  applicationId: string;
  workflowInstanceId: string;
  stepId: string;
  stepType: StepType;
  reason: string;
}): Promise<void> {
  await prisma.workflowStep.update({
    where: { id: input.stepId },
    data: {
      status: StepStatus.PENDING as never,
      errorMessage: input.reason,
      completedAt: null,
    },
  });
  await prisma.workflowInstance.update({
    where: { id: input.workflowInstanceId },
    data: { status: WorkflowStatus.SUSPENDED as never },
  });
  await prisma.application.update({
    where: { id: input.applicationId },
    data: {
      status: ApplicationStatus.AWAITING_CITIZEN_ACTION as never,
      currentStep: input.stepType as never,
    },
  });

  log.info('workflow parked awaiting citizen', {
    applicationId: input.applicationId,
    stepType: input.stepType,
  });
}

// ===========================================================================
// Step advance / failure
// ===========================================================================

async function advance(
  applicationId: string,
  serviceType: string,
  workflowInstanceId: string,
  completedStep: StepType,
): Promise<StepOutcome> {
  const next = nextDefinition(serviceType, completedStep);

  if (!next) {
    await prisma.workflowInstance.update({
      where: { id: workflowInstanceId },
      data: { status: WorkflowStatus.COMPLETED as never, completedAt: new Date() },
    });
    return { result: 'COMPLETED', nextStep: null };
  }

  await prisma.workflowInstance.update({
    where: { id: workflowInstanceId },
    data: { currentStep: next.stepType as never },
  });
  await prisma.application.update({
    where: { id: applicationId },
    data: { currentStep: next.stepType as never },
  });

  if (!next.automated) {
    // Hand over to a human. The application now sits in the officer queue.
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: { applicationNumber: true, validationSummary: true },
    });
    const report = application?.validationSummary as { status?: string } | null;
    const needsAttention = report?.status === ValidationStatus.FAILED;

    await prisma.workflowInstance.update({
      where: { id: workflowInstanceId },
      data: { status: WorkflowStatus.WAITING_FOR_OFFICER as never },
    });
    await prisma.application.update({
      where: { id: applicationId },
      data: {
        status: (needsAttention
          ? ApplicationStatus.REQUIRES_REVIEW
          : ApplicationStatus.UNDER_REVIEW) as never,
      },
    });
    await prisma.workflowStep.updateMany({
      where: { workflowInstanceId, stepType: StepType.OFFICER_REVIEW as never },
      data: { status: StepStatus.REQUIRES_REVIEW as never, startedAt: new Date() },
    });

    await notifyRole(
      [Role.OFFICER],
      `Application ${application?.applicationNumber} ready for review`,
      needsAttention
        ? 'Automated verification finished with issues that need officer attention.'
        : 'Automated verification finished cleanly and the application is ready for a decision.',
      applicationId,
      needsAttention ? NotificationType.WARNING : NotificationType.INFO,
    );
    await notifyApplicant(
      applicationId,
      'Verification complete',
      'Cross-department verification has finished. Your application is now with a review officer.',
      NotificationType.INFO,
    );

    return { result: 'WAITING_FOR_OFFICER' };
  }

  await enqueueStep(jobNameForStep(next.stepType), {
    applicationId,
    workflowInstanceId,
    stepType: next.stepType,
  });

  return { result: 'COMPLETED', nextStep: next.stepType };
}

interface FailureInput {
  applicationId: string;
  applicationNumber: string;
  serviceType: string;
  workflowInstanceId: string;
  stepId: string;
  stepType: StepType;
  attempt: number;
  maxAttempts: number;
  error: unknown;
}

async function handleStepFailure(input: FailureInput): Promise<StepOutcome> {
  const { applicationId, stepId, stepType, attempt, maxAttempts, error } = input;
  const def = definitionFor(input.serviceType, stepType);
  const connectorError = isConnectorError(error) ? error : null;
  const retryable = connectorError?.retryable ?? false;
  const message =
    error instanceof Error ? error.message : 'Unexpected failure executing workflow step';

  await recordAudit({
    action: AuditAction.WORKFLOW_STEP_FAILED,
    resourceType: 'WorkflowStep',
    resourceId: stepId,
    metadata: {
      applicationId,
      stepType,
      attempt,
      maxAttempts,
      retryable,
      errorKind: connectorError?.kind ?? 'INTERNAL',
    },
  });

  const attemptsLeft = retryable && attempt < maxAttempts;

  if (attemptsLeft) {
    await prisma.workflowStep.update({
      where: { id: stepId },
      data: {
        status: StepStatus.RETRYING as never,
        retryCount: attempt,
        errorMessage: `Attempt ${attempt}/${maxAttempts} failed: ${message}`,
      },
    });
    log.warn('step failed, will retry', { applicationId, stepType, attempt, maxAttempts });
    // Re-throw so BullMQ applies its backoff and schedules the next attempt.
    return { result: 'RETRY', error: error instanceof Error ? error : new Error(message) };
  }

  // Retries exhausted (or the failure was never retryable).
  await prisma.workflowStep.update({
    where: { id: stepId },
    data: {
      status: StepStatus.REQUIRES_REVIEW as never,
      retryCount: attempt,
      errorMessage: message,
      completedAt: new Date(),
    },
  });

  await raiseException({
    type: connectorError ? ExceptionType.CONNECTOR_FAILURE : ExceptionType.VALIDATION_FAILURE,
    severity: def.departmentCode && !getDepartmentDefinition(def.departmentCode).blocking
      ? Severity.LOW
      : Severity.HIGH,
    message: `${def.label} could not be completed after ${attempt} attempt(s): ${message}`,
    applicationId,
    workflowStepId: stepId,
    retryCount: attempt,
    details: {
      stepType,
      department: def.departmentCode,
      errorKind: connectorError?.kind ?? 'INTERNAL',
      retryable,
      attempts: attempt,
      maxAttempts,
    },
  });

  await notifyApplicant(
    applicationId,
    'Your application is delayed',
    def.departmentCode
      ? `${getDepartmentDefinition(def.departmentCode).name} is currently unavailable, so ${def.label.toLowerCase()} could not be completed. An officer has been notified.`
      : `${def.label} could not be completed automatically. An officer has been notified.`,
    NotificationType.WARNING,
  );

  const blocking = def.departmentCode
    ? getDepartmentDefinition(def.departmentCode).blocking
    : true;

  if (!blocking) {
    // Non-blocking department: record the failure and keep the workflow moving.
    log.warn('non-blocking step failed, continuing', { applicationId, stepType });
    return await advance(applicationId, input.serviceType, input.workflowInstanceId, stepType);
  }

  await prisma.workflowInstance.update({
    where: { id: input.workflowInstanceId },
    data: { status: WorkflowStatus.SUSPENDED as never },
  });
  await prisma.application.update({
    where: { id: applicationId },
    data: { status: ApplicationStatus.REQUIRES_REVIEW as never },
  });

  return { result: 'EXHAUSTED', message };
}

// ===========================================================================
// Individual step handlers
// ===========================================================================

interface StepContext {
  applicationId: string;
  stepId: string;
  citizenId: string;
  citizenExternalId: string;
  applicationNumber: string;
  serviceType: string;
}

type HandlerResult =
  | { kind: 'DONE'; output?: Record<string, unknown>; warning?: string }
  | { kind: 'WAITING_FOR_CITIZEN'; reason: string };

async function dispatchStep(stepType: StepType, ctx: StepContext): Promise<HandlerResult> {
  switch (stepType) {
    case StepType.CONSENT:
      return handleConsent(ctx);
    case StepType.IDENTITY_VERIFICATION:
    case StepType.INCOME_VERIFICATION:
    case StepType.EDUCATION_VERIFICATION:
    case StepType.LEGACY_CROSS_CHECK:
      return handleDepartmentLookup(stepType, ctx);
    case StepType.DOCUMENT_VALIDATION:
      return handleDocumentValidation(ctx);
    case StepType.DATA_QUALITY_CHECK:
      return handleDataQuality(ctx);
    case StepType.DEPARTMENT_WRITE_BACK:
      return handleWriteBack(ctx);
    default:
      throw new Error(`Step ${stepType} is not executed automatically`);
  }
}

/**
 * Hands the officer's decision to the department that owns the outcome.
 *
 * This is the only place GovFlow causes an effect in another system, so three
 * things are non-negotiable:
 *
 *   1. The idempotency key is derived from the application and stored, not
 *      generated per attempt. A retry after a timeout must reach the same row
 *      in the department's system, not create a second sanction.
 *   2. Delivery is recorded separately from the decision. The officer decided;
 *      whether the department has been told yet is a different fact, and
 *      conflating them would let an outage look like an undecided application.
 *   3. A department with no inbox is NOT_SUPPORTED, not FAILED. Retrying will
 *      never grow it an API; this needs a human, and saying so is the honest
 *      answer.
 */
async function handleWriteBack(ctx: StepContext): Promise<HandlerResult> {
  const service = getServiceDefinition(ctx.serviceType);
  const code = service.owningDepartment;

  const application = await prisma.application.findUniqueOrThrow({
    where: { id: ctx.applicationId },
    select: {
      status: true,
      decisionAt: true,
      decidedById: true,
      decisionNotes: true,
      requestedAmount: true,
    },
  });

  const approved = application.status === ApplicationStatus.APPROVED;
  if (!approved && application.status !== ApplicationStatus.REJECTED) {
    // Nothing has been decided, so there is nothing to deliver.
    return { kind: 'DONE', output: { skipped: 'no decision recorded' } };
  }

  // Stable across every attempt: the key IS the application's identity here.
  const idempotencyKey = `govflow:${ctx.applicationNumber}:${code}`;
  const existing = await prisma.departmentAcknowledgement.findUnique({
    where: { applicationId_departmentCode: { applicationId: ctx.applicationId, departmentCode: code } },
  });
  if (existing && existing.status === DeliveryStatus.DELIVERED) {
    return {
      kind: 'DONE',
      output: { departmentReference: existing.departmentReference, alreadyDelivered: true },
    };
  }

  const acknowledgement = await prisma.departmentAcknowledgement.upsert({
    where: { applicationId_departmentCode: { applicationId: ctx.applicationId, departmentCode: code } },
    create: { applicationId: ctx.applicationId, departmentCode: code, idempotencyKey },
    update: { attempts: { increment: 1 } },
  });

  const connector = await getConnector(code, { applicationId: ctx.applicationId });

  if (!connector.canReceiveDecisions()) {
    await prisma.departmentAcknowledgement.update({
      where: { id: acknowledgement.id },
      data: {
        status: DeliveryStatus.NOT_SUPPORTED as never,
        lastError: `${getDepartmentDefinition(code).name} exposes no write channel.`,
      },
    });
    await raiseException({
      applicationId: ctx.applicationId,
      workflowStepId: ctx.stepId,
      type: ExceptionType.CONNECTOR_FAILURE,
      severity: Severity.MEDIUM,
      message: `${getDepartmentDefinition(code).name} cannot receive decisions electronically. This decision must be recorded manually.`,
      details: { departmentCode: code, applicationNumber: ctx.applicationNumber },
    });
    await notifyRole(
      [Role.OFFICER],
      'Decision needs manual recording',
      `${ctx.applicationNumber} was decided, but ${getDepartmentDefinition(code).name} has no electronic inbox.`,
      ctx.applicationId,
      NotificationType.WARNING,
    );
    // The workflow continues: the decision stands, and the gap is visible
    // rather than silently pending forever.
    return { kind: 'DONE', output: { delivery: 'NOT_SUPPORTED', departmentCode: code } };
  }

  const { identifier } = await resolveDepartmentIdentifier(ctx.citizenId, code);

  const submission = {
    govflowReference: ctx.applicationNumber,
    citizenIdentifier: identifier,
    serviceType: ctx.serviceType,
    decision: (approved ? 'APPROVED' : 'REJECTED') as 'APPROVED' | 'REJECTED',
    decidedAt: (application.decisionAt ?? new Date()).toISOString(),
    // An opaque handle, not a name: the department needs to know a competent
    // officer decided, not who they were.
    officerReference: application.decidedById
      ? `GF-OFF-${application.decidedById.slice(-8).toUpperCase()}`
      : 'GF-OFF-UNKNOWN',
    reason: application.decisionNotes ?? '',
    amount: approved ? application.requestedAmount : null,
  };

  try {
    const receipt = await connector.submitDecision(submission, idempotencyKey);

    await prisma.departmentAcknowledgement.update({
      where: { id: acknowledgement.id },
      data: {
        status: DeliveryStatus.DELIVERED as never,
        departmentReference: receipt.departmentReference,
        deliveredAt: new Date(),
        requestPayload: submission as never,
        lastError: null,
      },
    });

    await recordAudit({
      action: AuditAction.DECISION_DELIVERED,
      resourceType: 'Application',
      resourceId: ctx.applicationId,
      metadata: {
        applicationNumber: ctx.applicationNumber,
        departmentCode: code,
        departmentReference: receipt.departmentReference,
        duplicate: receipt.status === 'DUPLICATE',
      },
    });

    await notifyApplicant(
      ctx.applicationId,
      'Recorded by the department',
      `${getDepartmentDefinition(code).name} has recorded this decision under reference ${receipt.departmentReference}.`,
      NotificationType.SUCCESS,
    );

    return {
      kind: 'DONE',
      output: {
        departmentCode: code,
        departmentReference: receipt.departmentReference,
        duplicate: receipt.status === 'DUPLICATE',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'delivery failed';
    await prisma.departmentAcknowledgement.update({
      where: { id: acknowledgement.id },
      data: { status: DeliveryStatus.FAILED as never, lastError: message },
    });
    await recordAudit({
      action: AuditAction.DECISION_DELIVERY_FAILED,
      resourceType: 'Application',
      resourceId: ctx.applicationId,
      metadata: { applicationNumber: ctx.applicationNumber, departmentCode: code },
    });
    // Rethrown so the existing retry/exception machinery applies unchanged.
    throw error;
  }
}

/** Consent gate. No department is contacted until every scope is GRANTED. */
async function handleConsent(ctx: StepContext): Promise<HandlerResult> {
  const consents = await prisma.consent.findMany({
    where: { applicationId: ctx.applicationId },
  });

  // Each service declares its own consent scopes: an income certificate never
  // asks for education data, so it must not wait on that consent.
  const required = getServiceDefinition(ctx.serviceType).consentScopes.map(
    (scope) => scope.departmentCode,
  );

  const missing = required.filter((scope) => {
    const consent = consents.find((c) => c.departmentCode === scope);
    return consent?.status !== ConsentStatus.GRANTED;
  });

  if (missing.length > 0) {
    await notifyApplicant(
      ctx.applicationId,
      'Consent required',
      `Please authorise GovFlow to verify your details with: ${missing.join(', ')}.`,
      NotificationType.WARNING,
    );
    return {
      kind: 'WAITING_FOR_CITIZEN',
      reason: `Awaiting citizen consent for: ${missing.join(', ')}`,
    };
  }

  return {
    kind: 'DONE',
    output: {
      grantedScopes: consents
        .filter((c) => c.status === ConsentStatus.GRANTED)
        .map((c) => c.departmentCode),
      grantedAt: consents
        .map((c) => c.grantedAt?.toISOString())
        .filter((v): v is string => Boolean(v)),
    },
  };
}

/**
 * The one handler behind all four departments. It never references a
 * department-specific field - the connector hands back common-data-model facts.
 */
async function handleDepartmentLookup(
  stepType: StepType,
  ctx: StepContext,
): Promise<HandlerResult> {
  const def = definitionFor(ctx.serviceType, stepType);
  const code = def.departmentCode!;

  if (def.requiresConsentFor) {
    const consent = await prisma.consent.findUnique({
      where: {
        applicationId_departmentCode: {
          applicationId: ctx.applicationId,
          departmentCode: def.requiresConsentFor,
        },
      },
    });
    if (consent?.status !== ConsentStatus.GRANTED) {
      return {
        kind: 'WAITING_FOR_CITIZEN',
        reason: `Consent for ${def.requiresConsentFor} is not granted`,
      };
    }
  }

  const connector = await getConnector(code, { applicationId: ctx.applicationId });
  // Looked up, never derived: see resolveDepartmentIdentifier. Throws a
  // non-retryable ConnectorError when GovFlow holds no link for this citizen,
  // which surfaces as an exception rather than three pointless retries.
  const { identifier } = await resolveDepartmentIdentifier(ctx.citizenId, code);
  const outcome = await connector.ingest(identifier);

  // Replace any earlier record of this type for this application.
  await prisma.normalizedRecord.deleteMany({
    where: { applicationId: ctx.applicationId, dataType: outcome.dataType as never },
  });
  const record = await prisma.normalizedRecord.create({
    data: {
      applicationId: ctx.applicationId,
      citizenId: ctx.citizenId,
      sourceSystem: outcome.sourceSystem,
      sourceRecordId: outcome.sourceRecordId,
      dataType: outcome.dataType as never,
      normalizedPayload: outcome.normalized.facts as never,
      qualityWarnings: outcome.qualityWarnings,
      validationStatus: (outcome.qualityWarnings.length > 0
        ? ValidationStatus.WARNING
        : ValidationStatus.PASSED) as never,
      mappingName: getDepartmentDefinition(code).mapping.name,
    },
  });

  await recordAudit({
    action: AuditAction.DATA_ACCESSED,
    resourceType: 'NormalizedRecord',
    resourceId: record.id,
    metadata: {
      applicationId: ctx.applicationId,
      department: code,
      sourceSystem: outcome.sourceSystem,
      sourceRecordId: outcome.sourceRecordId,
      mapping: getDepartmentDefinition(code).mapping.name,
      consentScope: def.requiresConsentFor,
    },
  });

  await notifyApplicant(
    ctx.applicationId,
    `${def.label} complete`,
    `${getDepartmentDefinition(code).name} responded and the data was normalised successfully.`,
    NotificationType.SUCCESS,
  );

  return {
    kind: 'DONE',
    output: {
      department: code,
      sourceSystem: outcome.sourceSystem,
      sourceRecordId: outcome.sourceRecordId,
      durationMs: outcome.durationMs,
      normalized: outcome.normalized.facts,
      qualityWarnings: outcome.qualityWarnings,
    },
    warning:
      outcome.qualityWarnings.length > 0 ? outcome.qualityWarnings.join(' ') : undefined,
  };
}

/** OCR + AI extraction for every document attached to the application. */
async function handleDocumentValidation(ctx: StepContext): Promise<HandlerResult> {
  const documents = await prisma.document.findMany({
    where: { applicationId: ctx.applicationId },
  });

  // A step named "document validation" may not complete having validated
  // nothing. If the service requires evidence and it is absent, the basis for
  // completing simply does not exist - park on the citizen instead.
  const required = getServiceDefinition(ctx.serviceType).policy.requiredDocuments;
  const missing = required.filter(
    (type) => !documents.some((d) => d.documentType === type),
  );

  if (missing.length > 0) {
    const readable = missing.map((m) => m.replace(/_/g, ' ').toLowerCase());
    await notifyApplicant(
      ctx.applicationId,
      'Document required',
      `Your application cannot proceed until you upload: ${readable.join(', ')}.`,
      NotificationType.WARNING,
    );
    return {
      kind: 'WAITING_FOR_CITIZEN',
      reason: `Awaiting required document(s): ${readable.join(', ')}`,
    };
  }

  if (documents.length === 0) {
    // No documents required by this service, and none supplied.
    return {
      kind: 'DONE',
      output: { processed: 0, note: 'This service requires no supporting documents.' },
    };
  }

  const processed: Record<string, unknown>[] = [];

  for (const document of documents) {
    await prisma.document.update({
      where: { id: document.id },
      data: { extractionStatus: 'PROCESSING' as never },
    });
    try {
      const result = await documentProcessor.process(
        document.storagePath,
        document.mimeType,
        document.documentType,
      );
      // Advisory only: a type mismatch is surfaced to the officer, never
      // used to reject the upload or the application.
      const classification = classifyDocument(result.textPreview, document.documentType);

      await prisma.document.update({
        where: { id: document.id },
        data: {
          extractionStatus: 'COMPLETED' as never,
          extractedData: {
            ...result.fields,
            typeCheck: {
              matches: classification.matches,
              looksLike: classification.looksLike,
              confidence: classification.confidence,
              reason: classification.reason,
            },
          } as never,
          extractionEngine: `${result.ocrEngine}+${result.engine}`,
          validationStatus: (!classification.matches || result.ocrEngine === 'UNAVAILABLE'
            ? ValidationStatus.WARNING
            : ValidationStatus.PASSED) as never,
          validationNotes: classification.matches
            ? result.engineNote
            : `${classification.reason} ${result.engineNote}`,
        },
      });
      processed.push({
        documentType: document.documentType,
        engine: result.engine,
        ocrEngine: result.ocrEngine,
        confidence: result.confidence,
        // Field values themselves stay on the Document row; the step output
        // keeps only counts so audit payloads carry no document contents.
        fieldsExtracted: Object.entries(result.fields).filter(
          ([, v]) => v !== null && v !== undefined,
        ).length,
      });
      await recordAudit({
        action: AuditAction.AI_VALIDATION_COMPLETED,
        resourceType: 'Document',
        resourceId: document.id,
        metadata: {
          applicationId: ctx.applicationId,
          documentType: document.documentType,
          engine: result.engine,
          ocrEngine: result.ocrEngine,
          confidence: result.confidence,
        },
      });
    } catch (error) {
      await prisma.document.update({
        where: { id: document.id },
        data: {
          extractionStatus: 'FAILED' as never,
          validationStatus: ValidationStatus.WARNING as never,
          validationNotes:
            error instanceof Error ? error.message : 'extraction failed unexpectedly',
        },
      });
      processed.push({ documentType: document.documentType, error: true });
    }
  }

  return { kind: 'DONE', output: { processed: documents.length, documents: processed } };
}

/** Cross-source mismatch detection. Advisory - it never decides the outcome. */
async function handleDataQuality(ctx: StepContext): Promise<HandlerResult> {
  const [facts, documents, unavailable] = await Promise.all([
    assembleFacts(ctx.applicationId),
    prisma.document.findMany({ where: { applicationId: ctx.applicationId } }),
    unavailableSources(ctx.applicationId),
  ]);

  const service = getServiceDefinition(ctx.serviceType);

  const report = await produceValidationReport({
    identity: facts.identity,
    income: facts.income,
    education: facts.education,
    legacy: facts.legacy,
    documents: documents.map((d) => ({
      documentType: d.documentType,
      extracted: (d.extractedData ?? null) as never,
    })),
    unavailableSources: unavailable,
    // Policy is per service, so one engine serves a means-tested benefit and a
    // plain certificate issuance without branching.
    policy: service.policy,
    expectedSources: expectedSources(ctx.serviceType),
  });

  await prisma.application.update({
    where: { id: ctx.applicationId },
    data: { validationSummary: report as never },
  });

  await recordAudit({
    action: AuditAction.AI_VALIDATION_COMPLETED,
    resourceType: 'Application',
    resourceId: ctx.applicationId,
    metadata: {
      engine: report.engine,
      status: report.status,
      findings: report.findings.length,
      advisoryOnly: true,
    },
  });

  // Each serious finding becomes an officer work item.
  const serious = report.findings.filter(
    (f) => f.severity === Severity.HIGH || f.severity === Severity.CRITICAL,
  );
  for (const finding of serious.slice(0, 5)) {
    await raiseException({
      type: exceptionTypeForFinding(finding),
      severity: finding.severity,
      message: finding.message,
      applicationId: ctx.applicationId,
      workflowStepId: ctx.stepId,
      details: {
        kind: finding.kind,
        field: finding.field,
        observed: finding.observed,
        confidence: finding.confidence,
        engine: report.engine,
      },
      notify: false,
    });
  }
  // Route by WHO CAN RESOLVE the blocker, not by how serious it is.
  // A missing document is only fixable by the citizen, so sending it to an
  // officer wastes the scarcest resource in the system on a file they cannot
  // act on. Judgement calls - mismatches, eligibility hints - do go forward.
  const citizenBlockers = serious.filter((f) => CITIZEN_RESOLVABLE.has(f.kind));

  if (citizenBlockers.length > 0) {
    const summary = citizenBlockers.map((f) => f.message).join(' ');
    await notifyApplicant(
      ctx.applicationId,
      'Action needed on your application',
      summary,
      NotificationType.WARNING,
    );
    return {
      kind: 'WAITING_FOR_CITIZEN',
      reason: `Awaiting citizen action: ${citizenBlockers.map((f) => f.field).join(', ')}`,
    };
  }

  if (serious.length > 0) {
    await notifyRole(
      [Role.OFFICER],
      `${serious.length} issue(s) on ${ctx.applicationNumber}`,
      report.summary,
      ctx.applicationId,
      NotificationType.WARNING,
    );
  }

  return {
    kind: 'DONE',
    output: {
      engine: report.engine,
      status: report.status,
      summary: report.summary,
      findingCount: report.findings.length,
      findings: report.findings,
    },
    warning: report.findings.length > 0 ? report.summary : undefined,
  };
}

/**
 * Findings only the citizen can clear. Everything else needs officer judgement.
 * A document that looks like the wrong type is deliberately NOT here: whether
 * it is genuinely wrong is a judgement, and wrongly bouncing a citizen is worse
 * than costing an officer a moment.
 */
const CITIZEN_RESOLVABLE = new Set<string>([
  FINDING_KIND.MISSING_DOCUMENT,
]);

function exceptionTypeForFinding(finding: ValidationFinding): ExceptionType {
  switch (finding.kind) {
    case 'MISSING_DOCUMENT':
      return ExceptionType.MISSING_DOCUMENT;
    case 'MISSING_FIELD':
      return ExceptionType.VALIDATION_FAILURE;
    case 'ELIGIBILITY_HINT':
      return ExceptionType.VALIDATION_FAILURE;
    default:
      return ExceptionType.DATA_MISMATCH;
  }
}

// ===========================================================================
// Resume & officer decision
// ===========================================================================

/**
 * Restarts a workflow parked by a failure or by missing consent. Used after an
 * admin restores a department, and after a citizen grants outstanding consent.
 */
export async function resumeWorkflow(
  applicationId: string,
  actor: { userId?: string | null } = {},
): Promise<{ resumedStep: StepType | null }> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { workflow: { include: { steps: { orderBy: { order: 'asc' } } } } },
  });
  if (!application?.workflow) throw new Error(`No workflow for application ${applicationId}`);

  if (
    application.status === ApplicationStatus.APPROVED ||
    application.status === ApplicationStatus.REJECTED
  ) {
    return { resumedStep: null };
  }

  // The first step that has not successfully completed is where we pick up.
  const target = application.workflow.steps.find(
    (s) => s.status !== StepStatus.COMPLETED && s.status !== StepStatus.SKIPPED,
  );
  if (!target) return { resumedStep: null };

  const def = definitionFor(application.serviceType, target.stepType as StepType);
  if (!def.automated) {
    await prisma.workflowInstance.update({
      where: { id: application.workflow.id },
      data: { status: WorkflowStatus.WAITING_FOR_OFFICER as never },
    });
    return { resumedStep: target.stepType as StepType };
  }

  await prisma.workflowStep.update({
    where: { id: target.id },
    data: {
      status: StepStatus.PENDING as never,
      errorMessage: null,
      retryCount: 0,
      completedAt: null,
    },
  });
  await prisma.workflowInstance.update({
    where: { id: application.workflow.id },
    data: { status: WorkflowStatus.RUNNING as never, currentStep: target.stepType },
  });
  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: ApplicationStatus.PROCESSING as never,
      currentStep: target.stepType,
    },
  });

  await recordAudit({
    action: AuditAction.WORKFLOW_RESUMED,
    resourceType: 'WorkflowInstance',
    resourceId: application.workflow.id,
    userId: actor.userId ?? null,
    metadata: { applicationId, resumedStep: target.stepType },
  });

  await enqueueStep(jobNameForStep(target.stepType as StepType), {
    applicationId,
    workflowInstanceId: application.workflow.id,
    stepType: target.stepType,
    manualRetry: true,
  });

  log.info('workflow resumed', { applicationId, step: target.stepType });
  return { resumedStep: target.stepType as StepType };
}

/**
 * Re-runs document validation and mismatch detection after new evidence
 * arrives (a late document upload, for example).
 *
 * Findings from the previous pass are marked superseded rather than left to
 * accumulate: the fresh run re-raises whatever still applies, so the officer's
 * queue reflects the current state of the file and not its history.
 */
export async function revalidateApplication(
  applicationId: string,
  actor: { userId?: string | null } = {},
): Promise<{ requeued: boolean }> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { workflow: { include: { steps: true } } },
  });
  if (!application?.workflow) return { requeued: false };

  if (
    application.status === ApplicationStatus.APPROVED ||
    application.status === ApplicationStatus.REJECTED
  ) {
    return { requeued: false };
  }

  const qualityStep = application.workflow.steps.find(
    (s) => s.stepType === StepType.DATA_QUALITY_CHECK,
  );
  // Only meaningful once the automated passes have already run at least once.
  if (!qualityStep || qualityStep.status !== StepStatus.COMPLETED) return { requeued: false };

  await prisma.exception.updateMany({
    where: {
      applicationId,
      status: ExceptionStatus.OPEN as never,
      type: {
        in: [
          ExceptionType.DATA_MISMATCH,
          ExceptionType.MISSING_DOCUMENT,
          ExceptionType.VALIDATION_FAILURE,
        ] as never,
      },
    },
    data: {
      status: ExceptionStatus.RESOLVED as never,
      resolvedAt: new Date(),
      resolutionNotes: 'Superseded by re-validation after new evidence was supplied.',
    },
  });

  await prisma.workflowStep.updateMany({
    where: {
      workflowInstanceId: application.workflow.id,
      stepType: {
        in: [StepType.DOCUMENT_VALIDATION, StepType.DATA_QUALITY_CHECK] as never,
      },
    },
    data: {
      status: StepStatus.PENDING as never,
      completedAt: null,
      errorMessage: null,
      retryCount: 0,
    },
  });
  await prisma.workflowStep.updateMany({
    where: {
      workflowInstanceId: application.workflow.id,
      stepType: StepType.OFFICER_REVIEW as never,
      status: StepStatus.REQUIRES_REVIEW as never,
    },
    data: { status: StepStatus.PENDING as never, startedAt: null },
  });

  await prisma.workflowInstance.update({
    where: { id: application.workflow.id },
    data: {
      status: WorkflowStatus.RUNNING as never,
      currentStep: StepType.DOCUMENT_VALIDATION as never,
    },
  });
  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: ApplicationStatus.PROCESSING as never,
      currentStep: StepType.DOCUMENT_VALIDATION as never,
    },
  });

  await recordAudit({
    action: AuditAction.WORKFLOW_RESUMED,
    resourceType: 'WorkflowInstance',
    resourceId: application.workflow.id,
    userId: actor.userId ?? null,
    metadata: { applicationId, reason: 'revalidation after new evidence' },
  });

  await enqueueStep(jobNameForStep(StepType.DOCUMENT_VALIDATION), {
    applicationId,
    workflowInstanceId: application.workflow.id,
    stepType: StepType.DOCUMENT_VALIDATION,
    manualRetry: true,
  });

  log.info('application re-validation queued', { applicationId });
  return { requeued: true };
}

export interface DecisionInput {
  applicationId: string;
  officerId: string;
  decision: 'APPROVE' | 'REJECT';
  notes: string;
}

/**
 * The only place an application reaches a terminal state. AI never calls this -
 * it requires an officer user id.
 */
export async function recordOfficerDecision(input: DecisionInput) {
  const { applicationId, officerId, decision, notes } = input;

  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { workflow: true },
  });
  if (!application) throw new Error(`Application ${applicationId} not found`);
  if (
    application.status === ApplicationStatus.APPROVED ||
    application.status === ApplicationStatus.REJECTED
  ) {
    throw new Error('This application has already been decided');
  }

  const approved = decision === 'APPROVE';
  const now = new Date();

  if (application.workflow) {
    await prisma.workflowStep.updateMany({
      where: {
        workflowInstanceId: application.workflow.id,
        stepType: StepType.OFFICER_REVIEW as never,
      },
      data: {
        status: StepStatus.COMPLETED as never,
        completedAt: now,
        output: { reviewedBy: officerId, decision } as never,
      },
    });
    await prisma.workflowStep.updateMany({
      where: {
        workflowInstanceId: application.workflow.id,
        stepType: StepType.FINAL_DECISION as never,
      },
      data: {
        status: (approved ? StepStatus.COMPLETED : StepStatus.REJECTED) as never,
        startedAt: now,
        completedAt: now,
        output: { decision, notes } as never,
      },
    });
    // The workflow is NOT complete here. The officer has decided; the
    // department that owns the outcome has not been told yet, and that
    // delivery is a step that can fail and be seen to have failed.
    await prisma.workflowInstance.update({
      where: { id: application.workflow.id },
      data: {
        status: WorkflowStatus.RUNNING as never,
        currentStep: StepType.DEPARTMENT_WRITE_BACK as never,
      },
    });
  }

  const updated = await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: (approved ? ApplicationStatus.APPROVED : ApplicationStatus.REJECTED) as never,
      currentStep: StepType.FINAL_DECISION as never,
      decisionAt: now,
      decidedById: officerId,
      decisionNotes: notes,
    },
  });

  await recordAudit({
    action: approved ? AuditAction.OFFICER_APPROVED : AuditAction.OFFICER_REJECTED,
    resourceType: 'Application',
    resourceId: applicationId,
    userId: officerId,
    actorRole: Role.OFFICER,
    metadata: { applicationNumber: application.applicationNumber, decision },
  });

  await notifyApplicant(
    applicationId,
    approved ? 'Your application has been approved' : 'Your application has been rejected',
    approved
      ? `Application ${application.applicationNumber} has been approved by a review officer.`
      : `Application ${application.applicationNumber} has been rejected. Reason: ${notes}`,
    approved ? NotificationType.SUCCESS : NotificationType.ERROR,
  );

  // Hand the decision to the department. Enqueued rather than awaited: the
  // officer's click must not block on somebody else's uptime.
  if (application.workflow) {
    const writeBack = await prisma.workflowStep.findFirst({
      where: {
        workflowInstanceId: application.workflow.id,
        stepType: StepType.DEPARTMENT_WRITE_BACK as never,
      },
    });
    if (writeBack) {
      await enqueueStep(jobNameForStep(StepType.DEPARTMENT_WRITE_BACK), {
        applicationId,
        workflowInstanceId: application.workflow.id,
        stepType: StepType.DEPARTMENT_WRITE_BACK,
      });
    } else {
      // An application created before write-back existed has no such step.
      // Completing the workflow is the correct answer for those.
      await prisma.workflowInstance.update({
        where: { id: application.workflow.id },
        data: { status: WorkflowStatus.COMPLETED as never, completedAt: now },
      });
    }
  }

  log.info('officer decision recorded', { applicationId, decision });
  return updated;
}
