import { StepType } from './enums.js';
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
 * The scholarship workflow definition. The engine walks these in order; each
 * one is materialised as a persisted WorkflowStep row so status is never
 * inferred from the UI.
 */
export const SCHOLARSHIP_WORKFLOW: WorkflowStepDefinition[] = [
  {
    stepType: StepType.CONSENT,
    order: 1,
    label: 'Consent verification',
    departmentCode: null,
    requiresConsentFor: null,
    automated: true,
    description: 'Confirms the citizen has authorised each cross-department lookup.',
  },
  {
    stepType: StepType.IDENTITY_VERIFICATION,
    order: 2,
    label: 'Identity verification',
    departmentCode: 'IDENTITY',
    requiresConsentFor: 'IDENTITY',
    automated: true,
    description: 'Fetches and normalises the citizen record from the Identity Registry.',
  },
  {
    stepType: StepType.INCOME_VERIFICATION,
    order: 3,
    label: 'Income verification',
    departmentCode: 'INCOME',
    requiresConsentFor: 'INCOME',
    automated: true,
    description: 'Fetches declared annual income from the Income Department.',
  },
  {
    stepType: StepType.EDUCATION_VERIFICATION,
    order: 4,
    label: 'Education verification',
    departmentCode: 'EDUCATION',
    requiresConsentFor: 'EDUCATION',
    automated: true,
    description: 'Confirms active enrolment with the Department of Higher Education.',
  },
  {
    stepType: StepType.LEGACY_CROSS_CHECK,
    order: 5,
    label: 'Legacy beneficiary cross-check',
    departmentCode: 'LEGACY',
    requiresConsentFor: 'INCOME',
    automated: true,
    description: 'Cross-checks the legacy CSV beneficiary export. Non-blocking.',
  },
  {
    stepType: StepType.DOCUMENT_VALIDATION,
    order: 6,
    label: 'Document validation',
    departmentCode: null,
    requiresConsentFor: null,
    automated: true,
    description: 'OCR + AI-assisted extraction of uploaded certificates.',
  },
  {
    stepType: StepType.DATA_QUALITY_CHECK,
    order: 7,
    label: 'Data quality & mismatch detection',
    departmentCode: null,
    requiresConsentFor: null,
    automated: true,
    description: 'Compares every source for mismatches, gaps and stale data.',
  },
  {
    stepType: StepType.OFFICER_REVIEW,
    order: 8,
    label: 'Officer review',
    departmentCode: null,
    requiresConsentFor: null,
    automated: false,
    description: 'A human officer reviews the consolidated evidence.',
  },
  {
    stepType: StepType.FINAL_DECISION,
    order: 9,
    label: 'Final decision',
    departmentCode: null,
    requiresConsentFor: null,
    automated: false,
    description: 'Approval or rejection recorded by the officer, plus citizen notification.',
  },
];

export const workflowConfig = {
  maxAttempts: env.WORKFLOW_MAX_ATTEMPTS,
  backoffMs: env.WORKFLOW_BACKOFF_MS,
  slaTargetDays: env.SLA_TARGET_DAYS,
  /** Fraction of the SLA window after which an application is AT_RISK. */
  slaAtRiskThreshold: 0.7,
} as const;

/** Eligibility policy for the demo scholarship scheme. */
export const SCHOLARSHIP_POLICY = {
  maxAnnualIncome: 250000,
  requiredEducationStatus: ['ACTIVE', 'ENROLLED'],
  requiredDocuments: ['INCOME_CERTIFICATE', 'EDUCATION_CERTIFICATE'],
  minAgeYears: 15,
  maxAgeYears: 35,
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
} as const;
