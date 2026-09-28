import axios, { type AxiosError, type AxiosInstance } from 'axios';
import type { AuthScheme, DepartmentDefinition, RestConnectorConfig } from '@govflow/contracts';
import {
  CONNECTOR_ERROR_KIND,
  DepartmentStatus,
  type ConnectorErrorKind,
  type DecisionAcknowledgement,
  type DecisionSubmission,
  type HealthStatus,
  type RawFetchResult,
} from '@govflow/contracts';
import { BaseConnector, type ConnectorContext } from './base-connector.js';
import { ConnectorError } from './errors.js';
import { applyMapping } from './transform.js';

function authHeaders(auth: AuthScheme): Record<string, string> {
  switch (auth.kind) {
    case 'API_KEY':
      return { [auth.header]: auth.value };
    case 'BEARER':
      return { authorization: `Bearer ${auth.token}` };
    case 'BASIC': {
      const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
      return { authorization: `Basic ${encoded}` };
    }
    case 'NONE':
    default:
      return {};
  }
}

/** Translates every transport failure mode into one retry decision. */
function classify(error: unknown): { kind: ConnectorErrorKind; status: number | null; detail: string } {
  if (axios.isAxiosError(error)) {
    const e = error as AxiosError;
    const status = e.response?.status ?? null;

    if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || e.message.includes('timeout')) {
      return { kind: CONNECTOR_ERROR_KIND.TIMEOUT, status, detail: 'upstream request timed out' };
    }
    if (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') {
      return {
        kind: CONNECTOR_ERROR_KIND.CONNECTION_REFUSED,
        status,
        detail: 'upstream host unreachable',
      };
    }
    if (status !== null) {
      if (status >= 500) {
        return {
          kind: CONNECTOR_ERROR_KIND.UPSTREAM_SERVER_ERROR,
          status,
          detail: `upstream returned HTTP ${status}`,
        };
      }
      if (status === 404) {
        return { kind: CONNECTOR_ERROR_KIND.NOT_FOUND, status, detail: 'record not found' };
      }
      if (status === 401 || status === 403) {
        return {
          kind: CONNECTOR_ERROR_KIND.UNAUTHORIZED,
          status,
          detail: 'upstream rejected our credentials',
        };
      }
      return {
        kind: CONNECTOR_ERROR_KIND.BAD_REQUEST,
        status,
        detail: `upstream rejected the request (HTTP ${status})`,
      };
    }
    return { kind: CONNECTOR_ERROR_KIND.UNKNOWN, status, detail: e.code ?? 'transport failure' };
  }
  return { kind: CONNECTOR_ERROR_KIND.UNKNOWN, status: null, detail: 'unexpected connector failure' };
}

/**
 * Base for every REST/JSON department. Handles auth, timeouts, error
 * classification and call logging so concrete connectors stay tiny.
 */
export abstract class RestConnector extends BaseConnector {
  protected readonly rest: RestConnectorConfig;
  private readonly http: AxiosInstance;

  constructor(def: DepartmentDefinition, ctx: ConnectorContext = {}) {
    super(def, ctx);
    if (def.connector.connectorType !== 'REST_JSON') {
      throw new Error(`${def.code} is not configured as a REST connector`);
    }
    this.rest = def.connector;
    this.http = axios.create({
      baseURL: this.rest.baseUrl,
      timeout: this.rest.timeoutMs,
      headers: { accept: 'application/json', ...authHeaders(this.rest.auth) },
    });
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now();
    const endpoint = `${this.rest.baseUrl}${this.rest.healthPath}`;
    try {
      const res = await this.http.get(this.rest.healthPath, {
        timeout: Math.min(this.rest.timeoutMs, 2500),
        params: { department: this.def.code },
      });
      const latencyMs = Date.now() - started;
      const healthy = res.status >= 200 && res.status < 300;
      const degraded = healthy && latencyMs > 1500;
      return {
        connector: this.def.code,
        status: !healthy
          ? DepartmentStatus.OFFLINE
          : degraded
            ? DepartmentStatus.DEGRADED
            : DepartmentStatus.ONLINE,
        latencyMs,
        checkedAt: new Date().toISOString(),
        detail: healthy ? `HTTP ${res.status}` : `unhealthy: HTTP ${res.status}`,
      };
    } catch (error) {
      const { detail } = classify(error);
      return {
        connector: this.def.code,
        status: DepartmentStatus.OFFLINE,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        detail: `${detail} (${endpoint})`,
      };
    }
  }

  async fetchCitizenData(identifier: string): Promise<RawFetchResult> {
    const path = this.rest.resourcePath.replace(':id', encodeURIComponent(identifier));
    const endpoint = `${this.rest.baseUrl}${path}`;
    const started = Date.now();

    try {
      const res = await this.http.get(path);
      const durationMs = Date.now() - started;

      if (res.data === null || typeof res.data !== 'object') {
        await this.log({
          connector: this.def.code,
          departmentCode: this.def.code,
          endpoint,
          method: 'GET',
          requestStatus: 'FAILURE',
          httpStatus: res.status,
          durationMs,
          errorKind: CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE,
          message: 'response body was not a JSON object',
        });
        throw new ConnectorError({
          connector: this.def.code,
          kind: CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE,
          message: `${this.def.name} returned a non-JSON body`,
          endpoint,
          httpStatus: res.status,
        });
      }

      await this.log({
        connector: this.def.code,
        departmentCode: this.def.code,
        endpoint,
        method: 'GET',
        requestStatus: 'SUCCESS',
        httpStatus: res.status,
        durationMs,
      });

      return {
        raw: res.data,
        sourceRecordId: identifier,
        endpoint,
        httpStatus: res.status,
        durationMs,
      };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      const durationMs = Date.now() - started;
      const { kind, status, detail } = classify(error);

      await this.log({
        connector: this.def.code,
        departmentCode: this.def.code,
        endpoint,
        method: 'GET',
        requestStatus: 'FAILURE',
        httpStatus: status,
        durationMs,
        errorKind: kind,
        message: detail,
      });

      throw new ConnectorError({
        connector: this.def.code,
        kind,
        message: `${this.def.name} is not responding correctly: ${detail}`,
        endpoint,
        httpStatus: status,
        cause: error,
      });
    }
  }

  /**
   * Hands a decision to the department and returns *their* reference for it.
   *
   * Two things are deliberate. The payload is produced by the same declarative
   * mapping engine as inbound traffic, only in reverse - the department's
   * naming conventions stay in configuration, never in core logic. And the
   * idempotency key travels as a header the department echoes back on a
   * duplicate, because the one call that causes an effect in somebody else's
   * system must be safe to retry after a timeout.
   */
  override async submitDecision(
    submission: DecisionSubmission,
    idempotencyKey: string,
  ): Promise<DecisionAcknowledgement> {
    const channel = this.def.decisionChannel;
    if (!channel) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.WRITE_NOT_SUPPORTED,
        message: `${this.def.name} cannot receive decisions: it exposes no write channel.`,
      });
    }

    const endpoint = `${this.rest.baseUrl}${channel.path}`;
    const { mapped, missingRequired } = applyMapping(submission, channel.mapping);
    if (missingRequired.length > 0) {
      throw new ConnectorError({
        connector: this.def.code,
        kind: CONNECTOR_ERROR_KIND.BAD_REQUEST,
        message: `Decision mapping "${channel.mapping.name}" could not populate: ${missingRequired.join(', ')}`,
        endpoint,
        details: { missingRequired },
      });
    }

    const started = Date.now();
    try {
      const res = await this.http.post(channel.path, mapped, {
        headers: { 'idempotency-key': idempotencyKey },
      });
      const durationMs = Date.now() - started;
      const body = res.data as Record<string, unknown> | null;
      const reference = body?.[channel.referencePath];

      if (typeof reference !== 'string' || reference.trim() === '') {
        // Without their reference the write is unprovable, so it does not
        // count as delivered however cheerful the status code was.
        await this.log({
          connector: this.def.code,
          departmentCode: this.def.code,
          endpoint,
          method: 'POST',
          requestStatus: 'FAILURE',
          httpStatus: res.status,
          durationMs,
          errorKind: CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE,
          message: `acknowledgement carried no "${channel.referencePath}"`,
        });
        throw new ConnectorError({
          connector: this.def.code,
          kind: CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE,
          message: `${this.def.name} accepted the decision but returned no reference number`,
          endpoint,
          httpStatus: res.status,
        });
      }

      await this.log({
        connector: this.def.code,
        departmentCode: this.def.code,
        endpoint,
        method: 'POST',
        requestStatus: 'SUCCESS',
        httpStatus: res.status,
        durationMs,
      });

      return {
        departmentReference: reference,
        acceptedAt: new Date().toISOString(),
        status: body?.duplicate === true ? 'DUPLICATE' : 'ACCEPTED',
        raw: body,
      };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      const durationMs = Date.now() - started;
      const { kind, status, detail } = classify(error);

      await this.log({
        connector: this.def.code,
        departmentCode: this.def.code,
        endpoint,
        method: 'POST',
        requestStatus: 'FAILURE',
        httpStatus: status,
        durationMs,
        errorKind: kind,
        message: detail,
      });

      throw new ConnectorError({
        connector: this.def.code,
        kind,
        message: `${this.def.name} did not accept the decision: ${detail}`,
        endpoint,
        httpStatus: status,
        cause: error,
      });
    }
  }

  /** Demo-only control plane: makes the simulated department misbehave for real. */
  async setSimulatedFailure(
    mode: 'ERROR_500' | 'TIMEOUT' | 'MALFORMED' | 'UNAUTHORIZED' | 'OFF',
  ): Promise<void> {
    const path = `${this.rest.controlPath}/${this.def.code.toLowerCase()}`;
    await this.http.post(path, { mode }, { timeout: 3000 });
  }
}
