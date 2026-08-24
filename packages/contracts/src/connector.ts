import type { ConnectorType, DataType, DepartmentStatus } from './enums.js';
import type { NormalizedRecord } from './common-data-model.js';

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
  UNKNOWN: 'UNKNOWN',
} as const;
export type ConnectorErrorKind =
  (typeof CONNECTOR_ERROR_KIND)[keyof typeof CONNECTOR_ERROR_KIND];
