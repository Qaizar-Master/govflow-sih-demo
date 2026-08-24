import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { ApiError } from '../lib/api-error.js';

/** Parses and REPLACES req.body with the validated value. */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(
        ApiError.badRequest(
          'The request body failed validation',
          result.error.issues.map((i) => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
          })),
        ),
      );
      return;
    }
    req.body = result.data as z.infer<S>;
    next();
  };
}

export function validateQuery<S extends ZodTypeAny>(schema: S) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(
        ApiError.badRequest(
          'The query string failed validation',
          result.error.issues.map((i) => ({
            path: i.path.join('.') || '(root)',
            message: i.message,
          })),
        ),
      );
      return;
    }
    // Express 4 exposes req.query as a getter-only property on some versions.
    Object.defineProperty(req, 'query', { value: result.data, writable: true });
    next();
  };
}
