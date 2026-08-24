/** Minimal structured logger. Keeps secrets and payloads out of stdout. */
type Level = 'debug' | 'info' | 'warn' | 'error';

const REDACTED = new Set([
  'password',
  'passwordHash',
  'token',
  'authorization',
  'apiKey',
  'jwt',
  'secret',
  'geminiApiKey',
]);

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACTED.has(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function emit(level: Level, scope: string, message: string, meta?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const payload = meta === undefined ? '' : ` ${JSON.stringify(scrub(meta))}`;
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
    line + payload,
  );
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, meta?: unknown) => emit('debug', scope, m, meta),
    info: (m: string, meta?: unknown) => emit('info', scope, m, meta),
    warn: (m: string, meta?: unknown) => emit('warn', scope, m, meta),
    error: (m: string, meta?: unknown) => emit('error', scope, m, meta),
  };
}

export type Logger = ReturnType<typeof createLogger>;
