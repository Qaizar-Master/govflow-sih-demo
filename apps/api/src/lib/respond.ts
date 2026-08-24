import type { Response } from 'express';
import type { ApiFailure, ApiSuccess, ErrorCode } from '@govflow/contracts';

/** { success: true, data, error: null } */
export function ok<T>(res: Response, data: T, status = 200): Response {
  const body: ApiSuccess<T> = { success: true, data, error: null };
  return res.status(status).json(body);
}

/** { success: false, data: null, error: { code, message } } */
export function fail(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: unknown,
): Response {
  const body: ApiFailure = {
    success: false,
    data: null,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
  return res.status(status).json(body);
}
