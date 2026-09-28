import { DocumentType, ServiceType, StepType } from './enums.js';
import { env } from './env.js';

export interface WorkflowStepDefinition {
  stepType: StepType;
  order: number;
  label: string;
  /** Department code when the step calls out to an external system. */
  departmentCode: string | null;
  /** Consent scope that must be GRANTED before this step may run. */
  requiresConsentFor: string | null;
  automated: boolean;
  description: string;
}

/**
 * Eligibility and evidence policy for one service.
 *
 * Policy is data, not code: the validation engine reads these values, so a new
 * scheme is a configuration entry rather than a new set of rules.
 */
export interface ServicePolicy {
  /** Income ceiling for means-tested services. Null when the service is not means-tested. */
  maxAnnualIncome: number | null;
  /** Enrolment statuses the service accepts. Empty when enrolment is irrelevant. */
  requiredEducationStatus: string[];
  requiredDocuments: DocumentType[];
  minAgeYears: number | null;
  maxAgeYears: number | null;
  /**
   * Flag an applicant already recorded in the legacy beneficiary export.
   * Duplicate benefit is the common real-world fraud, and it only matters for
   * services that actually disburse something.
   */
  flagExistingBeneficiary: boolean;
}

export interface ServiceDefinition {
  serviceType: ServiceType;
  name: string;
  /** Shown to the citizen when choosing a service. */
  summary: string;
  /** The department that owns the outcome. */
  owningDepartment: string;
  slaTargetDays: number;
  /** Consent scopes the citizen must grant before any lookup runs. */
  consentScopes: { departmentCode: string; purpose: string }[];
  steps: WorkflowStepDefinition[];
  policy: ServicePolicy;
}

// ---------------------------------------------------------------------------
// Shared step vocabulary
//
// Every service composes its workflow from the same steps. Only the selection
// and the ordering differ, which is what lets one engine and one set of
// connectors serve every service.
// ---------------------------------------------------------------------------

const CONSENT_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.CONSENT,
  label: 'Consent verification',
  departmentCode: null,
  requiresConsentFor: null,
  automated: true,
  description: 'Confirms the citizen has authorised each cross-department lookup.',
};

const IDENTITY_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.IDENTITY_VERIFICATION,
  label: 'Identity verification',
  departmentCode: 'IDENTITY',
  requiresConsentFor: 'IDENTITY',
  automated: true,
  description: 'Fetches and normalises the citizen record from the Identity Registry.',
};

const INCOME_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.INCOME_VERIFICATION,
  label: 'Income verification',
  departmentCode: 'INCOME',
  requiresConsentFor: 'INCOME',
  automated: true,
  description: 'Fetches declared annual income from the Income Department.',
};

const EDUCATION_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.EDUCATION_VERIFICATION,
  label: 'Education verification',
  departmentCode: 'EDUCATION',
  requiresConsentFor: 'EDUCATION',
  automated: true,
  description: 'Confirms active enrolment with the Department of Higher Education.',
};

const LEGACY_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.LEGACY_CROSS_CHECK,
  label: 'Legacy beneficiary cross-check',
  departmentCode: 'LEGACY',
  requiresConsentFor: 'INCOME',
  automated: true,
  description: 'Cross-checks the legacy CSV beneficiary export. Non-blocking.',
};

const DOCUMENT_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.DOCUMENT_VALIDATION,
  label: 'Document validation',
  departmentCode: null,
  requiresConsentFor: null,
  automated: true,
  description: 'OCR + AI-assisted extraction of uploaded certificates.',
};

const QUALITY_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.DATA_QUALITY_CHECK,
  label: 'Data quality & mismatch detection',
  departmentCode: null,
  requiresConsentFor: null,
  automated: true,
  description: 'Compares every source for mismatches, gaps and stale data.',
};

const REVIEW_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.OFFICER_REVIEW,
  label: 'Officer review',
  departmentCode: null,
  requiresConsentFor: null,
  automated: false,
  description: 'A human officer reviews the consolidated evidence.',
};

const DECISION_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.FINAL_DECISION,
  label: 'Final decision',
  departmentCode: null,
  requiresConsentFor: null,
  automated: false,
  description: 'Approval or rejection recorded by the officer, plus citizen notification.',
};

/**
 * Hands the decision back to the department that owns the outcome.
 *
 * Automated, and deliberately *after* the human decision rather than part of
 * it: the officer decides, and delivery is a separate thing that can fail,
 * retry and be seen to have failed. Folding it into FINAL_DECISION would mean
 * a department outage could look like an undecided application.
 */
const WRITE_BACK_STEP: Omit<WorkflowStepDefinition, 'order'> = {
  stepType: StepType.DEPARTMENT_WRITE_BACK,
  label: 'Record with the department',
  departmentCode: null,
  requiresConsentFor: null,
  automated: true,
  description:
    "Sends the decision to the owning department and stores that department's own reference number.",
};

/** Numbers the chosen steps 1..n so each service has a contiguous order. */
function sequence(steps: Omit<WorkflowStepDefinition, 'order'>[]): WorkflowStepDefinition[] {
  return steps.map((step, index) => ({ ...step, order: index + 1 }));
}

const CONSENT_PURPOSE: Record<string, string> = {
  IDENTITY: 'Verify the applicant’s identity, date of birth and district of residence.',
  INCOME: 'Confirm declared annual family income against the income registry.',
  EDUCATION: 'Confirm active enrolment and institution details.',
};

function consentScopes(codes: string[]) {
  return codes.map((departmentCode) => ({
    departmentCode,
    purpose: CONSENT_PURPOSE[departmentCode] ?? 'Cross-department verification.',
  }));
}

// ---------------------------------------------------------------------------
// Service catalogue
// ---------------------------------------------------------------------------

/**
 * Merit-cum-means scholarship. The fullest case: all four departments, a means
 * test, and two required certificates.
 */
export const SCHOLARSHIP_SERVICE: ServiceDefinition = {
  serviceType: ServiceType.SCHOLARSHIP,
  name: 'Merit-cum-Means Scholarship',
  summary:
    'State scholarship for enrolled students below the income ceiling. Verified against identity, income and education registries.',
  owningDepartment: 'EDUCATION',
  slaTargetDays: env.SLA_TARGET_DAYS,
  consentScopes: consentScopes(['IDENTITY', 'INCOME', 'EDUCATION']),
  steps: sequence([
    CONSENT_STEP,
    IDENTITY_STEP,
    INCOME_STEP,
    EDUCATION_STEP,
    LEGACY_STEP,
    DOCUMENT_STEP,
    QUALITY_STEP,
    REVIEW_STEP,
    DECISION_STEP,
    WRITE_BACK_STEP,
  ]),
  policy: {
    maxAnnualIncome: 250000,
    requiredEducationStatus: ['ACTIVE', 'ENROLLED'],
    requiredDocuments: [DocumentType.INCOME_CERTIFICATE, DocumentType.EDUCATION_CERTIFICATE],
    minAgeYears: 15,
    maxAgeYears: 35,
    flagExistingBeneficiary: false,
  },
};

/**
 * Income certificate issuance.
 *
 * Deliberately a different shape: this is a *document issuance*, not a benefit.
 * There is no means test to pass - the department is attesting to a figure, not
 * deciding whether it qualifies for anything. No education step, and no
 * supporting certificate is required because the certificate is the output.
 */
export const INCOME_CERTIFICATE_SERVICE: ServiceDefinition = {
  serviceType: ServiceType.INCOME_CERTIFICATE,
  name: 'Income Certificate',
  summary:
    'Official attestation of annual family income, issued by the Revenue Department for use with other schemes.',
  owningDepartment: 'INCOME',
  slaTargetDays: 3,
  consentScopes: consentScopes(['IDENTITY', 'INCOME']),
  steps: sequence([
    CONSENT_STEP,
    IDENTITY_STEP,
    INCOME_STEP,
    DOCUMENT_STEP,
    QUALITY_STEP,
    REVIEW_STEP,
    DECISION_STEP,
    WRITE_BACK_STEP,
  ]),
  policy: {
    maxAnnualIncome: null,
    requiredEducationStatus: [],
    requiredDocuments: [],
    minAgeYears: 18,
    maxAgeYears: null,
    flagExistingBeneficiary: false,
  },
};

/**
 * Ration card / PDS enrolment.
 *
 * The service where the legacy system earns its keep: PDS beneficiary data
 * lives in exactly this kind of old flat-file export, and an existing record
 * means a possible duplicate claim - the most common real-world fraud in
 * subsidy schemes.
 */
export const RATION_CARD_SERVICE: ServiceDefinition = {
  serviceType: ServiceType.RATION_CARD,
  name: 'Ration Card (PDS Enrolment)',
  summary:
    'Public Distribution System enrolment for eligible households, cross-checked against the legacy beneficiary register.',
  owningDepartment: 'INCOME',
  slaTargetDays: 7,
  consentScopes: consentScopes(['IDENTITY', 'INCOME']),
  steps: sequence([
    CONSENT_STEP,
    IDENTITY_STEP,
    INCOME_STEP,
    LEGACY_STEP,
    DOCUMENT_STEP,
    QUALITY_STEP,
    REVIEW_STEP,
    DECISION_STEP,
    WRITE_BACK_STEP,
  ]),
  policy: {
    maxAnnualIncome: 180000,
    requiredEducationStatus: [],
    requiredDocuments: [DocumentType.INCOME_CERTIFICATE],
    minAgeYears: 18,
    maxAgeYears: null,
    flagExistingBeneficiary: true,
  },
};

export const SERVICES: ServiceDefinition[] = [
  SCHOLARSHIP_SERVICE,
  INCOME_CERTIFICATE_SERVICE,
  RATION_CARD_SERVICE,
];

export function getServiceDefinition(serviceType: string): ServiceDefinition {
  const found = SERVICES.find((s) => s.serviceType === serviceType);
  if (!found) throw new Error(`Unknown service type: ${serviceType}`);
  return found;
}

/**
 * The services an officer in `departmentCode` is competent to decide.
 *
 * An officer works for one department, and a department owns the outcome of
 * some services and not others. A Revenue officer has no standing to approve a
 * scholarship, so the queue, the metrics and every decision endpoint are scoped
 * through this function rather than showing every application to everyone.
 */
export function serviceTypesOwnedBy(departmentCode: string): ServiceType[] {
  const code = departmentCode.toUpperCase();
  return SERVICES.filter((s) => s.owningDepartment === code).map((s) => s.serviceType);
}

/** Department codes that own at least one service - i.e. can have review officers. */
export function owningDepartmentCodes(): string[] {
  return [...new Set(SERVICES.map((s) => s.owningDepartment))];
}

export const workflowConfig = {
  maxAttempts: env.WORKFLOW_MAX_ATTEMPTS,
  backoffMs: env.WORKFLOW_BACKOFF_MS,
  slaTargetDays: env.SLA_TARGET_DAYS,
  /** Fraction of the SLA window after which an application is AT_RISK. */
  slaAtRiskThreshold: 0.7,
} as const;

export const QUEUE_NAMES = {
  WORKFLOW: 'govflow.workflow',
} as const;

export const JOB_NAMES = {
  APPLICATION_CREATED: 'workflow.application.created',
  RUN_STEP: 'workflow.step.run',
  IDENTITY_VERIFICATION: 'workflow.identity.verify',
  INCOME_VERIFICATION: 'workflow.income.verify',
  EDUCATION_VERIFICATION: 'workflow.education.verify',
  LEGACY_CROSS_CHECK: 'workflow.legacy.crosscheck',
  DOCUMENT_VALIDATION: 'workflow.document.validate',
  DATA_QUALITY_CHECK: 'workflow.dataquality.check',
  DEPARTMENT_WRITE_BACK: 'workflow.decision.writeback',
} as const;
