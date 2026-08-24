import type { Role, SlaStatus } from './enums.js';

/** Uniform success envelope: { success, data, error }. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  error: null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiFailure {
  success: false;
  data: null;
  error: ApiErrorBody;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const ERROR_CODE = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string | null;
  citizenId: string | null;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: Role;
  departmentId: string | null;
  iat?: number;
  exp?: number;
}

export interface SlaAssessment {
  status: SlaStatus;
  targetDays: number;
  elapsedHours: number;
  remainingHours: number;
  dueAt: string;
  reasons: string[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
