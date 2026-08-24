import {
  ApplicationStatus,
  AuditAction,
  ConsentStatus,
  ExceptionStatus,
  ExceptionType,
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
  toDepartmentIdentifier,
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
import { produceValidationReport } from '../validation/index.js';
import { documentProcessor } from '../documents/index.js';
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

  // A decided application never runs more automation.
  if (
    application.status === ApplicationStatus.APPROVED ||
    application.status === ApplicationStatus.REJECTED
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
      await prisma.workflowStep.update({
        where: { id: step.id },
        data: { status: StepStatus.PENDING as never, errorMessage: handled.reason },
      });
      await prisma.workflowInstance.update({
        where: { id: application.workflow.id },
        data: { status: WorkflowStatus.SUSPENDED as never },
      });
      log.info('workflow parked awaiting citizen', { applicationId, stepType });
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
    default:
      throw new Error(`Step ${stepType} is not executed automatically`);
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
  const identifier = toDepartmentIdentifier(ctx.citizenExternalId, code);
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

  if (documents.length === 0) {
    return {
      kind: 'DONE',
      output: { processed: 0, note: 'No documents were uploaded.' },
      warning: 'No documents uploaded - the data quality step will flag what is missing.',
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
      await prisma.document.update({
        where: { id: document.id },
        data: {
          extractionStatus: 'COMPLETED' as never,
          extractedData: result.fields as never,
          extractionEngine: `${result.ocrEngine}+${result.engine}`,
          validationStatus: (result.ocrEngine === 'UNAVAILABLE'
            ? ValidationStatus.WARNING
            : ValidationStatus.PASSED) as never,
          validationNotes: result.engineNote,
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
    await prisma.workflowInstance.update({
      where: { id: application.workflow.id },
      data: {
        status: WorkflowStatus.COMPLETED as never,
        currentStep: StepType.FINAL_DECISION as never,
        completedAt: now,
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

  log.info('officer decision recorded', { applicationId, decision });
  return updated;
}
