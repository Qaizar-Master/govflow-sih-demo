import { ERROR_CODE, type ErrorCode } from '@govflow/contracts';

/**
 * The only error type route handlers throw. Everything else that escapes a
 * handler is treated as an internal error and reported without detail, so
 * stack traces and upstream internals never reach a client.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, ERROR_CODE.VALIDATION_ERROR, message, details);
  }
  static unauthorized(message = 'Authentication is required') {
    return new ApiError(401, ERROR_CODE.UNAUTHORIZED, message);
  }
  static forbidden(message = 'You do not have access to this resource') {
    return new ApiError(403, ERROR_CODE.FORBIDDEN, message);
  }
  static notFound(message = 'Resource not found') {
    return new ApiError(404, ERROR_CODE.NOT_FOUND, message);
  }
  static conflict(message: string, details?: unknown) {
    return new ApiError(409, ERROR_CODE.CONFLICT, message, details);
  }
  static upstream(message: string, details?: unknown) {
    return new ApiError(502, ERROR_CODE.UPSTREAM_ERROR, message, details);
  }
}
