import type { ConnectorType, DataType, DepartmentStatus } from './enums.js';
import type { NormalizedRecord } from './common-data-model.js';
import type { DecisionAcknowledgement, DecisionSubmission } from './decision.js';

export interface HealthStatus {
  connector: string;
  status: DepartmentStatus;
  latencyMs: number;
  checkedAt: string;
  detail?: string;
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

/** Raw, still-department-shaped payload plus the metadata needed for audit. */
export interface RawFetchResult {
  raw: unknown;
  sourceRecordId: string;
  endpoint: string;
  httpStatus: number | null;
  durationMs: number;
}

export interface ConnectorFetchOutcome {
  connector: string;
  sourceSystem: string;
  dataType: DataType;
  sourceRecordId: string;
  raw: unknown;
  normalized: NormalizedRecord;
  durationMs: number;
  qualityWarnings: string[];
}

/**
 * The contract every department adapter implements. The core application
 * only ever depends on this interface, never on a concrete connector.
 */
export interface DepartmentConnector {
  getName(): string;
  getDepartmentCode(): string;
  getConnectorType(): ConnectorType;
  getDataType(): DataType;
  healthCheck(): Promise<HealthStatus>;
  fetchCitizenData(identifier: string): Promise<RawFetchResult>;
  transform(data: unknown): NormalizedRecord;
  validate(data: unknown): ValidationResult;
  /** fetch -> validate -> transform -> quality check, as one auditable unit. */
  ingest(identifier: string): Promise<ConnectorFetchOutcome>;

  /**
   * Whether this department can receive a decision at all.
   *
   * Not every system can. A nightly CSV export has no inbox, and pretending
   * otherwise would be the sort of convenient fiction this project exists to
   * avoid - so the capability is declared, and the workflow degrades visibly
   * when it is absent rather than silently dropping the decision.
   */
  canReceiveDecisions(): boolean;

  /**
   * Hands a decision to the department that owns the outcome and returns
   * *their* reference for it.
   *
   * `idempotencyKey` is required, not optional: this call is the one place
   * GovFlow causes an effect in someone else's system, and a retry after a
   * timeout must not sanction the same application twice.
   */
  submitDecision(
    submission: DecisionSubmission,
    idempotencyKey: string,
  ): Promise<DecisionAcknowledgement>;
}

export const CONNECTOR_ERROR_KIND = {
  TIMEOUT: 'TIMEOUT',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  UPSTREAM_SERVER_ERROR: 'UPSTREAM_SERVER_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  BAD_REQUEST: 'BAD_REQUEST',
  MALFORMED_RESPONSE: 'MALFORMED_RESPONSE',
  SCHEMA_VALIDATION: 'SCHEMA_VALIDATION',
  SOURCE_UNAVAILABLE: 'SOURCE_UNAVAILABLE',
  /**
   * GovFlow holds no identifier for this citizen in this department, so there
   * is nothing to ask for. Not retryable: the link must be established, not
   * waited for.
   */
  IDENTIFIER_NOT_LINKED: 'IDENTIFIER_NOT_LINKED',
  /**
   * The department has no inbox - a CSV export cannot be written to. Not
   * retryable: no amount of waiting grows an API.
   */
  WRITE_NOT_SUPPORTED: 'WRITE_NOT_SUPPORTED',
  UNKNOWN: 'UNKNOWN',
} as const;
export type ConnectorErrorKind =
  (typeof CONNECTOR_ERROR_KIND)[keyof typeof CONNECTOR_ERROR_KIND];
