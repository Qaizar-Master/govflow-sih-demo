import type { NextFunction, Request, Response } from 'express';
import { Role, type AuthUser } from '@govflow/contracts';
import { prisma } from '@govflow/core';
import { ApiError } from '../lib/api-error.js';
import { verifyToken } from '../lib/tokens.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

function bearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Verifies the JWT and re-reads the user from the database on every request.
 * The token is not trusted for role or department: a role change or a deleted
 * account takes effect immediately rather than at token expiry.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = bearer(req);
    if (!token) throw ApiError.unauthorized();

    const payload = verifyToken(token);
    if (!payload?.sub) throw ApiError.unauthorized('Session is invalid or has expired');

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        departmentId: true,
        citizenId: true,
      },
    });
    if (!user) throw ApiError.unauthorized('Session is invalid or has expired');

    req.user = user as AuthUser;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Role gate. Authorisation is enforced here, in Express - the frontend's role
 * checks are presentation only and are never relied upon.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!allowed.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `This action requires one of the following roles: ${allowed.join(', ')}`,
        ),
      );
    }
    next();
  };
}

export const requireCitizen = requireRole(Role.CITIZEN);
export const requireOfficer = requireRole(Role.OFFICER, Role.ADMIN);
export const requireAdmin = requireRole(Role.ADMIN);

/**
 * Ownership check for citizen-scoped resources. Officers and admins may read
 * any application; a citizen may only ever touch their own.
 */
export async function assertApplicationAccess(
  req: Request,
  applicationId: string,
): Promise<{ id: string; citizenId: string }> {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { id: true, citizenId: true },
  });
  if (!application) throw ApiError.notFound('Application not found');

  const user = req.user;
  if (!user) throw ApiError.unauthorized();

  if (user.role === Role.CITIZEN) {
    if (!user.citizenId || user.citizenId !== application.citizenId) {
      // Deliberately a 404, so an id cannot be probed for existence.
      throw ApiError.notFound('Application not found');
    }
  }
  return application;
}
