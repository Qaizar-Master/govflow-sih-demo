'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, setToken } from './api';
import type { AuthUser, Role } from './types';

interface SessionState {
  user: AuthUser | null;
  citizen: {
    externalId: string;
    name: string;
    dateOfBirth: string;
    district: string;
    email: string | null;
    phone: string | null;
  } | null;
  department: { code: string; name: string } | null;
}

interface AuthContextValue extends SessionState {
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

/** Landing page for each role after sign-in. */
export function homeFor(role: Role): string {
  if (role === 'ADMIN') return '/admin/dashboard';
  if (role === 'OFFICER') return '/officer/dashboard';
  return '/dashboard';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<SessionState>({
    user: null,
    citizen: null,
    department: null,
  });
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    // No token means nobody is signed in. Asking the API to confirm that
    // costs a round trip and a guaranteed 401 on every anonymous page load.
    if (!getToken()) {
      setState({ user: null, citizen: null, department: null });
      setLoading(false);
      return;
    }
    try {
      const data = await api.get<SessionState>('/api/auth/me');
      setState(data);
    } catch {
      setState({ user: null, citizen: null, department: null });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = React.useCallback(
    async (email: string, password: string) => {
      const data = await api.publicPost<{ token: string; user: AuthUser }>(
        '/api/auth/login',
        { email, password },
      );
      setToken(data.token);
      await refresh();
      return data.user;
    },
    [refresh],
  );

  const logout = React.useCallback(() => {
    setToken(null);
    setState({ user: null, citizen: null, department: null });
  }, []);

  const value = React.useMemo(
    () => ({ ...state, loading, login, logout, refresh }),
    [state, loading, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Client-side route guard. Presentation only - every endpoint re-checks the
 * role server-side, so a tampered browser gains nothing.
 */
export function useRequireRole(allowed: Role[]): { ready: boolean; user: AuthUser | null } {
  const { user, loading } = useAuth();
  const router = useRouter();

  React.useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    if (!allowed.includes(user.role)) {
      router.replace(homeFor(user.role));
    }
    // `allowed` is a literal array at every call site, so it is intentionally
    // not a dependency - including it would re-run the guard on every render.
  }, [user, loading, router]);

  return { ready: !loading && Boolean(user) && allowed.includes(user!.role), user };
}

/** Polls a loader on an interval. The prototype uses polling rather than sockets. */
export function usePolling<T>(
  loader: () => Promise<T>,
  intervalMs = 5000,
  enabled = true,
): { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> } {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const loaderRef = React.useRef(loader);
  loaderRef.current = loader;

  const reload = React.useCallback(async () => {
    try {
      const next = await loaderRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;
    void reload();
    if (intervalMs <= 0) return;
    const timer = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs, enabled]);

  return { data, error, loading, reload };
}
