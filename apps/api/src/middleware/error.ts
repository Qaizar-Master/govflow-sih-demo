import type { NextFunction, Request, Response } from 'express';
import { ERROR_CODE, env } from '@govflow/contracts';
import { createLogger } from '@govflow/core';
import { isConnectorError } from '@govflow/connector-sdk';
import { ZodError } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { fail } from '../lib/respond.js';

const log = createLogger('api');

export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, ERROR_CODE.NOT_FOUND, `No route matches ${req.method} ${req.path}`);
}

/**
 * Terminal error handler.
 *
 * Clients receive a stable code and a safe message. Stack traces, SQL and
 * upstream response bodies are logged server-side only.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ApiError) {
    if (error.status >= 500) {
      log.error('request failed', { path: req.path, code: error.code, message: error.message });
    }
    fail(res, error.status, error.code, error.message, error.details);
    return;
  }

  if (error instanceof ZodError) {
    fail(
      res,
      400,
      ERROR_CODE.VALIDATION_ERROR,
      'The request body failed validation',
      error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
    );
    return;
  }

  if (isConnectorError(error)) {
    log.warn('connector error surfaced to a request', error.toPublicJSON());
    fail(
      res,
      502,
      ERROR_CODE.UPSTREAM_ERROR,
      `A department system is unavailable: ${error.message}`,
      { connector: error.connector, kind: error.kind, retryable: error.retryable },
    );
    return;
  }

  // Multer rejects oversized or disallowed uploads with its own error shape.
  const maybeMulter = error as { code?: string; message?: string };
  if (maybeMulter.code === 'UNSUPPORTED_FILE_TYPE') {
    fail(res, 400, ERROR_CODE.VALIDATION_ERROR, maybeMulter.message ?? 'Unsupported file type');
    return;
  }
  if (maybeMulter.code === 'LIMIT_FILE_SIZE') {
    fail(
      res,
      400,
      ERROR_CODE.VALIDATION_ERROR,
      `The file exceeds the ${Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`,
    );
    return;
  }

  log.error('unhandled error', {
    path: req.path,
    method: req.method,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack?.split('\n').slice(0, 4).join(' | ') : undefined,
  });

  fail(
    res,
    500,
    ERROR_CODE.INTERNAL_ERROR,
    'An unexpected error occurred. The incident has been logged.',
  );
}
