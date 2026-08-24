import { describe, expect, it } from 'vitest';
import { CONNECTOR_ERROR_KIND } from '@govflow/contracts';
import { ConnectorError, isConnectorError } from '@govflow/connector-sdk';

describe('connector error classification', () => {
  it.each([
    [CONNECTOR_ERROR_KIND.TIMEOUT, true],
    [CONNECTOR_ERROR_KIND.CONNECTION_REFUSED, true],
    [CONNECTOR_ERROR_KIND.UPSTREAM_SERVER_ERROR, true],
    [CONNECTOR_ERROR_KIND.SOURCE_UNAVAILABLE, true],
    [CONNECTOR_ERROR_KIND.NOT_FOUND, false],
    [CONNECTOR_ERROR_KIND.UNAUTHORIZED, false],
    [CONNECTOR_ERROR_KIND.BAD_REQUEST, false],
    [CONNECTOR_ERROR_KIND.MALFORMED_RESPONSE, false],
    [CONNECTOR_ERROR_KIND.SCHEMA_VALIDATION, false],
  ])('marks %s retryable=%s', (kind, retryable) => {
    const error = new ConnectorError({ connector: 'INCOME', kind, message: 'x' });
    expect(error.retryable).toBe(retryable);
  });

  it('exposes a public shape with no stack or upstream internals', () => {
    const error = new ConnectorError({
      connector: 'INCOME',
      kind: CONNECTOR_ERROR_KIND.UPSTREAM_SERVER_ERROR,
      message: 'upstream returned HTTP 503',
      httpStatus: 503,
      details: { secret: 'must not leak' },
    });
    const json = error.toPublicJSON();
    expect(json).toEqual({
      connector: 'INCOME',
      kind: 'UPSTREAM_SERVER_ERROR',
      message: 'upstream returned HTTP 503',
      httpStatus: 503,
      retryable: true,
    });
    expect(JSON.stringify(json)).not.toContain('must not leak');
  });

  it('is detectable across module boundaries', () => {
    expect(isConnectorError(new ConnectorError({ connector: 'X', kind: 'UNKNOWN', message: 'y' }))).toBe(true);
    expect(isConnectorError(new Error('plain'))).toBe(false);
  });
});
