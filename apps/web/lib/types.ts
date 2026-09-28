/**
 * Wire types for the GovFlow API.
 *
 * Deliberately declared here rather than imported from @govflow/contracts: that
 * package loads server-only configuration (dotenv, node:fs), and the web app is
 * a separate deployable that speaks REST only. A handful of duplicated string
 * unions is a better trade than dragging node built-ins into the browser bundle.
 */

export type Role = 'CITIZEN' | 'OFFICER' | 'ADMIN';

export type ApplicationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'AWAITING_CITIZEN_ACTION'
  | 'REQUIRES_REVIEW'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

export type StepStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'RETRYING'
  | 'REQUIRES_REVIEW'
  | 'REJECTED'
  | 'SKIPPED';

export type SlaStatus = 'ON_TRACK' | 'AT_RISK' | 'OVERDUE';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type ConsentStatus = 'PENDING' | 'GRANTED' | 'DENIED' | 'REVOKED' | 'EXPIRED';
export type DepartmentStatus = 'ONLINE' | 'DEGRADED' | 'OFFLINE';
export type ValidationStatusValue = 'PENDING' | 'PASSED' | 'WARNING' | 'FAILED';
export type DocumentType =
  | 'IDENTITY_PROOF'
  | 'INCOME_CERTIFICATE'
  | 'EDUCATION_CERTIFICATE'
  | 'OTHER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  citizenId: string | null;
}

export interface SlaAssessment {
  status: SlaStatus;
  targetDays: number;
  elapsedHours: number;
  remainingHours: number;
  dueAt: string;
  reasons: string[];
}

export interface ValidationFinding {
  kind: string;
  severity: Severity;
  field: string;
  message: string;
  observed: Record<string, string | number | null>;
  confidence: number;
}

export interface ValidationReport {
  status: ValidationStatusValue;
  engine: 'GEMINI' | 'RULE_BASED';
  engineNote: string;
  findings: ValidationFinding[];
  summary: string;
  generatedAt: string;
  advisoryOnly: boolean;
}

export interface ApplicationListItem {
  id: string;
  applicationNumber: string;
  serviceType: string;
  status: ApplicationStatus;
  currentStep: string;
  workflowStatus: string | null;
  citizenName: string;
  citizenExternalId: string;
  district: string;
  submittedAt: string;
  decisionAt: string | null;
  openExceptions: number;
  documentCount: number;
  validationStatus: string | null;
  findingCount: number;
  sla: SlaAssessment;
}

export interface TimelineEntry {
  stepType: string;
  label: string;
  order: number;
  status: StepStatus;
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

export interface ConsentRecord {
  id: string;
  departmentCode: string;
  departmentName: string;
  purpose: string;
  status: ConsentStatus;
  grantedAt: string | null;
  expiresAt: string | null;
}

export interface DocumentRecord {
  id: string;
  documentType: DocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  extractionStatus: string;
  extractedData: Record<string, unknown> | null;
  validationStatus: string;
  validationNotes: string | null;
  extractionEngine: string | null;
  uploadedAt: string;
}

export interface ExceptionRecord {
  id: string;
  type: string;
  severity: Severity;
  message: string;
  status: string;
  retryCount: number;
  details: unknown;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  application?: {
    id: string;
    applicationNumber: string;
    status: string;
    citizenName: string;
    citizenExternalId: string;
  } | null;
  step?: {
    stepType: string;
    label: string;
    retryCount: number;
    maxAttempts: number;
  } | null;
}

export interface AuditEntry {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string;
  actor: { name: string; role?: string } | null;
  actorRole: string | null;
  metadata: unknown;
  ipAddress?: string | null;
  createdAt: string;
}

export type ReconciliationVerdict =
  | 'MATCH'
  | 'CITIZEN_EDITED'
  | 'REGISTRY_CHANGED'
  | 'DIVERGENT'
  | 'AWAITING_VERIFICATION'
  | 'CITIZEN_DECLARED'
  | 'NO_EVIDENCE';

export interface ReconciliationRow {
  key: string;
  label: string;
  authority: 'REGISTRY' | 'REGISTRY_CORRECTABLE' | 'CITIZEN';
  prefilled: string | number | null;
  submitted: string | number | null;
  verified: string | number | null;
  verdict: ReconciliationVerdict;
  explanation: string;
  departmentCode: string | null;
}

export interface ReconciliationReport {
  rows: ReconciliationRow[];
  attentionCount: number;
  matchedCount: number;
  available: boolean;
}

/** One field of a service's declarative application form. */
export interface FormFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  authority: 'REGISTRY' | 'REGISTRY_CORRECTABLE' | 'CITIZEN';
  required: boolean;
  source: { departmentCode: string; cdmField: string } | null;
  helpText?: string;
  options?: string[];
  unit?: string;
  placeholder?: string;
}

export interface FormSchema {
  serviceType: string;
  sections: { title: string; description: string; fields: FormFieldDefinition[] }[];
}

export type PrefillFieldStatus =
  | 'FILLED'
  | 'CONSENT_REQUIRED'
  | 'UNAVAILABLE'
  | 'NOT_HELD'
  | 'CITIZEN_SUPPLIED';

export interface PrefilledField {
  key: string;
  label: string;
  authority: 'REGISTRY' | 'REGISTRY_CORRECTABLE' | 'CITIZEN';
  value: string | number | null;
  status: PrefillFieldStatus;
  source: { departmentCode: string; sourceSystem: string; fetchedAt: string } | null;
  note?: string;
}

export interface PrefillResult {
  applicationId: string;
  fields: PrefilledField[];
  unavailable: { departmentCode: string; reason: string }[];
  filledCount: number;
  totalPrefillable: number;
  fetchedAt: string;
}

export interface DepartmentAcknowledgementRecord {
  departmentCode: string;
  departmentName: string;
  departmentReference: string | null;
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'NOT_SUPPORTED';
  attempts: number;
  lastError: string | null;
  deliveredAt: string | null;
}

export interface ApplicationDetail {
  application: {
    id: string;
    applicationNumber: string;
    serviceType: string;
    status: ApplicationStatus;
    currentStep: string;
    requestedAmount: number | null;
    institutionClaim: string | null;
    submittedAt: string;
    decisionAt: string | null;
    decisionNotes: string | null;
    decidedBy: { id: string; name: string } | null;
    slaTargetDays: number;
    validationSummary: ValidationReport | null;
    submittedValues: Record<string, string | number | null> | null;
    stepsPending: number;
  };
  reconciliation: ReconciliationReport;
  acknowledgements: DepartmentAcknowledgementRecord[];
  citizen: {
    id: string;
    externalId: string;
    name: string;
    dateOfBirth: string;
    district: string;
    email: string | null;
    phone: string | null;
  };
  consents: ConsentRecord[];
  documents: DocumentRecord[];
  exceptions: ExceptionRecord[];
  reviewNotes: {
    id: string;
    note: string;
    author: { id: string; name: string; role: string };
    createdAt: string;
  }[];
  verification: {
    identity: Record<string, unknown> | null;
    income: Record<string, unknown> | null;
    education: Record<string, unknown> | null;
    legacy: Record<string, unknown> | null;
    consolidated: Record<string, unknown> & { provenance: Record<string, string> };
    receivedAt: Record<string, string>;
    sources: {
      sourceSystem: string;
      sourceRecordId: string;
      dataType: string;
      mappingName: string;
      validationStatus: string;
      qualityWarnings: string[];
      receivedAt: string;
    }[];
  };
  timeline: TimelineEntry[];
  sla: SlaAssessment;
  auditTrail: AuditEntry[];
}

export interface NotificationRecord {
  id: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  application: { id: string; applicationNumber: string } | null;
}

export interface DepartmentHealth {
  connector: string;
  status: DepartmentStatus;
  latencyMs: number;
  checkedAt: string;
  detail?: string;
  departmentId: string | null;
  name: string;
  type: string;
  connectorType: string;
  blocking: boolean;
  simulatedFailureMode: string | null;
  recentFailures: number;
  recentRequests: number;
  avgLatencyMs: number | null;
}

export interface PlatformMetrics {
  applications: {
    total: number;
    pending: number;
    completed: number;
    byStatus: Record<string, number>;
  };
  sla: Record<SlaStatus, number>;
  exceptions: { open: number; bySeverity: Record<string, number> };
  connectors: {
    windowHours: number;
    success: number;
    failure: number;
    successRate: number | null;
    perConnector: {
      connector: string;
      success: number;
      failure: number;
      avgDurationMs: number | null;
    }[];
  };
  documents: Record<string, number>;
  avgProcessingHours: number | null;
  auditEventsLast24h: number;
  queue: {
    name: string;
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  } | null;
  api: {
    uptimeSeconds: number;
    totalRequests: number;
    totalErrors: number;
    errorRate: number | null;
    routes: { route: string; count: number; errors: number; avgMs: number; maxMs: number }[];
  };
}

export interface OfficerMetrics {
  total: number;
  awaitingCitizen: number;
  awaitingReview: number;
  requiresReview: number;
  underReview: number;
  approved: number;
  rejected: number;
  atRisk: number;
  openExceptions: number;
  avgProcessingHours: number | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
