import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Wraps an async handler so a rejected promise reaches the error middleware.
 * Without this, one failing department call would surface as an unhandled
 * rejection instead of a clean 502.
 */
export function handler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
