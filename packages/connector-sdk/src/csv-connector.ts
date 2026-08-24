import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { type z } from 'zod';
import type { CsvConnectorConfig, DepartmentDefinition } from '@govflow/contracts';
import {
  CONNECTOR_ERROR_KIND,
  DepartmentStatus,
  type HealthStatus,
  type RawFetchResult,
} from '@govflow/contracts';
import { BaseConnector, type ConnectorContext } from './base-connector.js';
import { ConnectorError } from './errors.js';

export interface CsvConnectorContext extends ConnectorContext {
  /**
   * Demo control plane. A file-based department has no API to break, so an
   * admin-triggered outage is modelled as "the nightly export never arrived".
   */
  forceUnavailable?: boolean;
}

export interface CsvRowSummary {
  total: number;
  columns: string[];
}

/**
 * Legacy interoperability: a department with no API at all, only a CSV export.
 * It implements exactly the same connector contract as the REST departments, so
 * the workflow engine cannot tell the difference.
 */
export abstract class CsvConnector extends BaseConnector {
  protected readonly csv: CsvConnectorConfig;
  private readonly forceUnavailable: boolean;

  constructor(def: DepartmentDefinition, ctx: CsvConnectorContext = {}) {
    super(def, ctx);
    if (def.connector.connectorType !== 'CSV_FILE') {
      throw new Error(`${def.code} is not configured as a CSV connector`);
    }
    this.csv = def.connector;
    this.forceUnavailable = ctx.forceUnavailable ?? false;
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now();
    if (this.forceUnavailable) {
      return {
        connector: this.def.code,
        status: DepartmentStatus.OFFLINE,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        detail: 'simulated outage: nightly export not delivered',
      };
    }
    try {
      const stat = await fsp.stat(this.csv.filePath);
      const ageHours = (Date.now() - stat.mtimeMs) / 3_600_000;
      return {
        connector: this.def.code,
        status: ageHours > 168 ? DepartmentStatus.DEGRADED : DepartmentStatus.ONLINE,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        detail:
          ageHours > 168
            ? `export is ${Math.round(ageHours / 24)} days old`
            : `export present (${stat.size} bytes)`,
      };
    } catch {
      return {
        connector: this.def.code,
        status: DepartmentStatus.OFFLINE,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        detail: 'export file missing or unreadable',
      };
    }
  }

  /** Parses the whole export. Used by both lookup and the bulk import job. */
  readAllRows(): Record<string, string>[] {
    if (this.forceUnavailable) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.SOURCE_UNAVAILABLE,
        message: 'Legacy export is unavailable (simulated outage)',
        endpoint: this.csv.filePath,
      });
    }
    let content: string;
    try {
      content = fs.readFileSync(this.csv.filePath, 'utf8');
    } catch (error) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.SOURCE_UNAVAILABLE,
        message: `Legacy export could not be read at ${this.csv.filePath}`,
        endpoint: this.csv.filePath,
        cause: error,
      });
    }
    try {
      return parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: this.csv.delimiter,
        relax_column_count: true,
      }) as Record<string, string>[];
    } catch (error) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE,
        message: 'Legacy export is not parseable as CSV',
        endpoint: this.csv.filePath,
        cause: error,
      });
    }
  }

  async fetchCitizenData(identifier: string): Promise<RawFetchResult> {
    const started = Date.now();
    const endpoint = `file://${this.csv.filePath}#${this.csv.lookupColumn}=${identifier}`;
    try {
      const rows = this.readAllRows();
      const wanted = identifier.trim().toUpperCase();
      const row = rows.find(
        (r) => (r[this.csv.lookupColumn] ?? '').trim().toUpperCase() === wanted,
      );
      const durationMs = Date.now() - started;

      if (!row) {
        await this.log({
          connector: this.def.code,
          departmentCode: this.def.code,
          endpoint,
          method: 'READ',
          requestStatus: 'FAILURE',
          httpStatus: null,
          durationMs,
          errorKind: CONNECTOR_ERROR_KIND.NOT_FOUND,
          message: 'no matching row in legacy export',
        });
        throw new ConnectorError({
          connector: this.def.code,
          kind: CONNECTOR_ERROR_KIND.NOT_FOUND,
          message: `No legacy beneficiary row for ${identifier}`,
          endpoint,
        });
      }

      await this.log({
        connector: this.def.code,
        departmentCode: this.def.code,
        endpoint,
        method: 'READ',
        requestStatus: 'SUCCESS',
        httpStatus: null,
        durationMs,
      });

      return {
        raw: row,
        sourceRecordId: row[this.csv.lookupColumn] ?? identifier,
        endpoint,
        httpStatus: null,
        durationMs,
      };
    } catch (error) {
      if (error instanceof ConnectorError) {
        if (error.kind !== CONNECTOR_ERROR_KIND.NOT_FOUND) {
          await this.log({
            connector: this.def.code,
            departmentCode: this.def.code,
            endpoint,
            method: 'READ',
            requestStatus: 'FAILURE',
            httpStatus: null,
            durationMs: Date.now() - started,
            errorKind: error.kind,
            message: error.message,
          });
        }
        throw error;
      }
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.UNKNOWN,
        message: 'Unexpected failure reading the legacy export',
        endpoint,
        cause: error,
      });
    }
  }

  /** Row-level schema used by the bulk importer to report per-row errors. */
  abstract get rowSchema(): z.ZodTypeAny;
}
