import jwt from 'jsonwebtoken';
import { env, type JwtPayload, type Role } from '@govflow/contracts';

export function signToken(payload: {
  sub: string;
  email: string;
  role: Role;
  departmentId: string | null;
}): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    issuer: 'govflow',
  });
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, env.JWT_SECRET, { issuer: 'govflow' }) as JwtPayload;
  } catch {
    return null;
  }
}
