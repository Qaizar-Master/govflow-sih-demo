import { type z } from 'zod';
import type { DepartmentDefinition } from '@govflow/contracts';
import {
  CONNECTOR_ERROR_KIND,
  normalizedRecordSchema,
  type ConnectorFetchOutcome,
  type ConnectorType,
  type DataType,
  type DepartmentConnector,
  type HealthStatus,
  type NormalizedRecord,
  type RawFetchResult,
  type ValidationResult,
} from '@govflow/contracts';
import { ConnectorError } from './errors.js';
import { applyMapping } from './transform.js';

export interface ConnectorLogEntry {
  connector: string;
  departmentCode: string;
  endpoint: string;
  method: string;
  requestStatus: 'SUCCESS' | 'FAILURE';
  httpStatus: number | null;
  durationMs: number;
  errorKind?: string;
  message?: string;
}

export interface ConnectorContext {
  /** Persists a connector call for the admin monitoring view. Never throws. */
  onLog?: (entry: ConnectorLogEntry) => void | Promise<void>;
}

/**
 * Shared connector machinery.
 *
 * Subclasses supply only two department-specific things: how to reach the
 * source (`fetchCitizenData`, `healthCheck`) and the *raw* schema that source
 * emits. Validation, mapping, normalisation and quality checking are identical
 * for every department, which is what makes onboarding a new one cheap.
 */
export abstract class BaseConnector implements DepartmentConnector {
  protected readonly def: DepartmentDefinition;
  protected readonly ctx: ConnectorContext;

  constructor(def: DepartmentDefinition, ctx: ConnectorContext = {}) {
    this.def = def;
    this.ctx = ctx;
  }

  getName(): string {
    return this.def.name;
  }

  getDepartmentCode(): string {
    return this.def.code;
  }

  getConnectorType(): ConnectorType {
    return this.def.connector.connectorType;
  }

  getDataType(): DataType {
    return this.def.dataType;
  }

  getSourceSystem(): string {
    return this.def.sourceSystem;
  }

  isBlocking(): boolean {
    return this.def.blocking;
  }

  /** The shape the external system actually returns, before normalisation. */
  protected abstract rawSchema: z.ZodTypeAny;

  abstract healthCheck(): Promise<HealthStatus>;
  abstract fetchCitizenData(identifier: string): Promise<RawFetchResult>;

  /** Schema-validates the *upstream* payload. A bad payload is not retryable. */
  validate(data: unknown): ValidationResult {
    const result = this.rawSchema.safeParse(data);
    if (result.success) return { valid: true, issues: [] };
    return {
      valid: false,
      issues: result.error.issues.map((i) => ({
        path: i.path.join('.') || '(root)',
        code: i.code,
        message: i.message,
      })),
    };
  }

  /** Maps the department dialect onto the common data model. */
  transform(data: unknown): NormalizedRecord {
    const { mapped, missingRequired } = applyMapping(data, this.def.mapping);

    if (missingRequired.length > 0) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.SCHEMA_VALIDATION,
        message: `Mapping "${this.def.mapping.name}" could not populate required field(s): ${missingRequired.join(', ')}`,
        details: { missingRequired, mapping: this.def.mapping.name },
      });
    }

    const candidate = { dataType: this.def.dataType, facts: mapped };
    const parsed = normalizedRecordSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.SCHEMA_VALIDATION,
        message: 'Normalised record failed common-data-model validation',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }
    return parsed.data;
  }

  /**
   * Non-fatal data-quality observations. Surfaced to the officer rather than
   * failing the step - real government data is rarely pristine.
   */
  protected qualityCheck(_record: NormalizedRecord): string[] {
    return [];
  }

  protected async log(entry: ConnectorLogEntry): Promise<void> {
    try {
      await this.ctx.onLog?.(entry);
    } catch (error) {
      // Observability must never break the ingestion path - but a silently
      // failing log sink is its own defect, so say so on stderr.
      // eslint-disable-next-line no-console
      console.warn(
        `[connector:${this.def.code}] failed to persist a connector log entry:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * The full ingestion pipeline as one auditable unit:
   * fetch -> schema-validate -> map -> normalise -> quality-check.
   */
  async ingest(identifier: string): Promise<ConnectorFetchOutcome> {
    const fetched = await this.fetchCitizenData(identifier);

    const validation = this.validate(fetched.raw);
    if (!validation.valid) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE,
        message: `${this.def.name} returned a payload that does not match its published contract`,
        endpoint: fetched.endpoint,
        httpStatus: fetched.httpStatus,
        details: validation.issues,
      });
    }

    const normalized = this.transform(fetched.raw);

    return {
      connector: this.def.code,
      sourceSystem: this.def.sourceSystem,
      dataType: this.def.dataType,
      sourceRecordId: fetched.sourceRecordId,
      raw: fetched.raw,
      normalized,
      durationMs: fetched.durationMs,
      qualityWarnings: this.qualityCheck(normalized),
    };
  }
}
