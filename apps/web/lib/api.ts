'use client';

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';

const TOKEN_KEY = 'govflow.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

/** Error carrying the API's own code so callers can branch without parsing text. */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface Envelope<T> {
  success: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
}

async function request<T>(
  path: string,
  init: RequestInit & { auth?: boolean } = {},
): Promise<T> {
  const { auth = true, headers, ...rest } = init;
  const token = auth ? getToken() : null;

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      accept: 'application/json',
      ...(rest.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    cache: 'no-store',
  });

  let body: Envelope<T> | null = null;
  try {
    body = (await response.json()) as Envelope<T>;
  } catch {
    body = null;
  }

  if (!response.ok || !body?.success) {
    const code = body?.error?.code ?? 'NETWORK_ERROR';
    const message =
      body?.error?.message ??
      (response.status === 0
        ? 'The GovFlow API is unreachable.'
        : `Request failed with status ${response.status}`);
    // A stale or revoked session should land the user back on the sign-in page.
    if (response.status === 401 && typeof window !== 'undefined') {
      setToken(null);
    }
    throw new ApiClientError(response.status, code, message, body?.error?.details);
  }

  return body.data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, payload?: unknown) =>
    request<T>(path, {
      method: 'POST',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  patch: <T>(path: string, payload?: unknown) =>
    request<T>(path, {
      method: 'PATCH',
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  /** Unauthenticated calls (login, register, public metadata). */
  publicPost: <T>(path: string, payload: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(payload), auth: false }),
  publicGet: <T>(path: string) => request<T>(path, { method: 'GET', auth: false }),
  documentUrl: (applicationId: string, documentId: string) =>
    `${API_BASE}/api/applications/${applicationId}/documents/${documentId}/content`,
  baseUrl: API_BASE,
};
