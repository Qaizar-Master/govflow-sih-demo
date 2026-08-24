import type { NextFunction, Request, Response } from 'express';
import { recordRequest } from '../lib/observability.js';

/** Times every request and files it under its route pattern, not its URL. */
export function observe(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1_000_000;
    const route = `${req.method} ${req.route?.path ? req.baseUrl + req.route.path : req.path}`;
    recordRequest(route, ms, res.statusCode);
  });
  next();
}
