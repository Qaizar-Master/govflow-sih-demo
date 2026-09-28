/**
 * Domain enumerations.
 *
 * These are declared as plain const objects (not TS `enum`) so the exact same
 * literals can be shared by the Express API, the BullMQ worker, the Next.js
 * client bundle and the Prisma schema without a build step.
 */

export const Role = {
  CITIZEN: 'CITIZEN',
  OFFICER: 'OFFICER',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ServiceType = {
  SCHOLARSHIP: 'SCHOLARSHIP',
  INCOME_CERTIFICATE: 'INCOME_CERTIFICATE',
  RATION_CARD: 'RATION_CARD',
} as const;
export type ServiceType = (typeof ServiceType)[keyof typeof ServiceType];

export const ApplicationStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  PROCESSING: 'PROCESSING',
  /**
   * Blocked on something only the citizen can supply - a missing document or
   * an ungranted consent. Deliberately distinct from REQUIRES_REVIEW: it must
   * NOT reach an officer, because there is nothing for them to decide yet.
   */
  AWAITING_CITIZEN_ACTION: 'AWAITING_CITIZEN_ACTION',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApplicationStatus = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const WorkflowStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  WAITING_FOR_OFFICER: 'WAITING_FOR_OFFICER',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SUSPENDED: 'SUSPENDED',
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

export const StepStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  REQUIRES_REVIEW: 'REQUIRES_REVIEW',
  REJECTED: 'REJECTED',
  SKIPPED: 'SKIPPED',
} as const;
export type StepStatus = (typeof StepStatus)[keyof typeof StepStatus];

export const StepType = {
  CONSENT: 'CONSENT',
  IDENTITY_VERIFICATION: 'IDENTITY_VERIFICATION',
  INCOME_VERIFICATION: 'INCOME_VERIFICATION',
  EDUCATION_VERIFICATION: 'EDUCATION_VERIFICATION',
  LEGACY_CROSS_CHECK: 'LEGACY_CROSS_CHECK',
  DOCUMENT_VALIDATION: 'DOCUMENT_VALIDATION',
  DATA_QUALITY_CHECK: 'DATA_QUALITY_CHECK',
  OFFICER_REVIEW: 'OFFICER_REVIEW',
  FINAL_DECISION: 'FINAL_DECISION',
  /** Hands the decision back to the department that owns the outcome. */
  DEPARTMENT_WRITE_BACK: 'DEPARTMENT_WRITE_BACK',
} as const;
export type StepType = (typeof StepType)[keyof typeof StepType];

export const ConsentStatus = {
  PENDING: 'PENDING',
  GRANTED: 'GRANTED',
  DENIED: 'DENIED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
} as const;
export type ConsentStatus = (typeof ConsentStatus)[keyof typeof ConsentStatus];

export const DepartmentType = {
  IDENTITY: 'IDENTITY',
  INCOME: 'INCOME',
  EDUCATION: 'EDUCATION',
  LEGACY: 'LEGACY',
} as const;
export type DepartmentType = (typeof DepartmentType)[keyof typeof DepartmentType];

export const ConnectorType = {
  REST_JSON: 'REST_JSON',
  CSV_FILE: 'CSV_FILE',
} as const;
export type ConnectorType = (typeof ConnectorType)[keyof typeof ConnectorType];

export const DepartmentStatus = {
  ONLINE: 'ONLINE',
  DEGRADED: 'DEGRADED',
  OFFLINE: 'OFFLINE',
} as const;
export type DepartmentStatus = (typeof DepartmentStatus)[keyof typeof DepartmentStatus];

export const DataType = {
  IDENTITY: 'IDENTITY',
  INCOME: 'INCOME',
  EDUCATION: 'EDUCATION',
  LEGACY_BENEFICIARY: 'LEGACY_BENEFICIARY',
} as const;
export type DataType = (typeof DataType)[keyof typeof DataType];

export const ExceptionType = {
  CONNECTOR_FAILURE: 'CONNECTOR_FAILURE',
  SCHEMA_ERROR: 'SCHEMA_ERROR',
  VALIDATION_FAILURE: 'VALIDATION_FAILURE',
  DATA_MISMATCH: 'DATA_MISMATCH',
  MISSING_DOCUMENT: 'MISSING_DOCUMENT',
  SLA_BREACH: 'SLA_BREACH',
  CONSENT_MISSING: 'CONSENT_MISSING',
} as const;
export type ExceptionType = (typeof ExceptionType)[keyof typeof ExceptionType];

export const Severity = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const ExceptionStatus = {
  OPEN: 'OPEN',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
  IGNORED: 'IGNORED',
} as const;
export type ExceptionStatus = (typeof ExceptionStatus)[keyof typeof ExceptionStatus];

export const DocumentType = {
  IDENTITY_PROOF: 'IDENTITY_PROOF',
  INCOME_CERTIFICATE: 'INCOME_CERTIFICATE',
  EDUCATION_CERTIFICATE: 'EDUCATION_CERTIFICATE',
  OTHER: 'OTHER',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const ExtractionStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;
export type ExtractionStatus = (typeof ExtractionStatus)[keyof typeof ExtractionStatus];

export const ValidationStatus = {
  PENDING: 'PENDING',
  PASSED: 'PASSED',
  WARNING: 'WARNING',
  FAILED: 'FAILED',
} as const;
export type ValidationStatus = (typeof ValidationStatus)[keyof typeof ValidationStatus];

export const IdentifierLinkSource = {
  /** Synthetic dataset. Demo only - carries no assurance. */
  SEED: 'SEED',
  /** Returned by the identity provider when the citizen authenticated. */
  SSO_ASSERTION: 'SSO_ASSERTION',
  /** Entered by a departmental officer against a physical document. */
  OFFICER_ASSERTED: 'OFFICER_ASSERTED',
} as const;
export type IdentifierLinkSource =
  (typeof IdentifierLinkSource)[keyof typeof IdentifierLinkSource];

/** How far a decision has got towards the department that owns the outcome. */
export const DeliveryStatus = {
  PENDING: 'PENDING',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  /** The department has no inbox. Needs a human, not a retry. */
  NOT_SUPPORTED: 'NOT_SUPPORTED',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const NotificationType = {
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Derived at read time from timestamps - never persisted. */
export const SlaStatus = {
  ON_TRACK: 'ON_TRACK',
  AT_RISK: 'AT_RISK',
  OVERDUE: 'OVERDUE',
} as const;
export type SlaStatus = (typeof SlaStatus)[keyof typeof SlaStatus];

export const AuditAction = {
  USER_REGISTERED: 'USER_REGISTERED',
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  /** An identity provider asserted who this person is. */
  IDENTITY_ASSERTED: 'IDENTITY_ASSERTED',
  /** A departmental identifier was linked to a citizen, with a provenance. */
  IDENTIFIER_LINKED: 'IDENTIFIER_LINKED',
  APPLICATION_CREATED: 'APPLICATION_CREATED',
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  CONSENT_REQUESTED: 'CONSENT_REQUESTED',
  CONSENT_GRANTED: 'CONSENT_GRANTED',
  CONSENT_DENIED: 'CONSENT_DENIED',
  CONSENT_REVOKED: 'CONSENT_REVOKED',
  DATA_ACCESSED: 'DATA_ACCESSED',
  CONNECTOR_REQUEST: 'CONNECTOR_REQUEST',
  CONNECTOR_FAILURE: 'CONNECTOR_FAILURE',
  WORKFLOW_STARTED: 'WORKFLOW_STARTED',
  WORKFLOW_STEP_STARTED: 'WORKFLOW_STEP_STARTED',
  WORKFLOW_STEP_COMPLETED: 'WORKFLOW_STEP_COMPLETED',
  WORKFLOW_STEP_FAILED: 'WORKFLOW_STEP_FAILED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  AI_VALIDATION_COMPLETED: 'AI_VALIDATION_COMPLETED',
  EXCEPTION_CREATED: 'EXCEPTION_CREATED',
  EXCEPTION_RESOLVED: 'EXCEPTION_RESOLVED',
  OFFICER_APPROVED: 'OFFICER_APPROVED',
  OFFICER_REJECTED: 'OFFICER_REJECTED',
  OFFICER_NOTE_ADDED: 'OFFICER_NOTE_ADDED',
  DEPARTMENT_FAILURE_SIMULATED: 'DEPARTMENT_FAILURE_SIMULATED',
  DEPARTMENT_RESTORED: 'DEPARTMENT_RESTORED',
  LEGACY_IMPORT_RUN: 'LEGACY_IMPORT_RUN',
  WORKFLOW_RESUMED: 'WORKFLOW_RESUMED',
  /** A decision was accepted by the department that owns the outcome. */
  DECISION_DELIVERED: 'DECISION_DELIVERED',
  DECISION_DELIVERY_FAILED: 'DECISION_DELIVERY_FAILED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
