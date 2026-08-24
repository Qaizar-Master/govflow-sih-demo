import { CONNECTOR_ERROR_KIND, type ConnectorErrorKind } from '@govflow/contracts';

/** Failure kinds worth another attempt: transient by nature. */
const RETRYABLE: ConnectorErrorKind[] = [
  CONNECTOR_ERROR_KIND.TIMEOUT,
  CONNECTOR_ERROR_KIND.CONNECTION_REFUSED,
  CONNECTOR_ERROR_KIND.UPSTREAM_SERVER_ERROR,
  CONNECTOR_ERROR_KIND.SOURCE_UNAVAILABLE,
  CONNECTOR_ERROR_KIND.UNKNOWN,
];

export interface ConnectorErrorOptions {
  connector: string;
  kind: ConnectorErrorKind;
  message: string;
  httpStatus?: number | null;
  endpoint?: string;
  details?: unknown;
  cause?: unknown;
}

/**
 * The single error type crossing the connector boundary. Callers decide
 * retry-vs-exception from `retryable` alone and never inspect upstream
 * transport details.
 */
export class ConnectorError extends Error {
  readonly connector: string;
  readonly kind: ConnectorErrorKind;
  readonly httpStatus: number | null;
  readonly endpoint: string | undefined;
  readonly details: unknown;
  readonly retryable: boolean;

  constructor(opts: ConnectorErrorOptions) {
    super(opts.message);
    this.name = 'ConnectorError';
    this.connector = opts.connector;
    this.kind = opts.kind;
    this.httpStatus = opts.httpStatus ?? null;
    this.endpoint = opts.endpoint;
    this.details = opts.details;
    this.retryable = RETRYABLE.includes(opts.kind);
    if (opts.cause !== undefined) this.cause = opts.cause;
  }

  /** Safe for API responses and audit logs: no stack, no upstream internals. */
  toPublicJSON() {
    return {
      connector: this.connector,
      kind: this.kind,
      message: this.message,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
    };
  }
}

export function isConnectorError(e: unknown): e is ConnectorError {
  return e instanceof ConnectorError;
}
