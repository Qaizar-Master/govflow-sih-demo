/**
 * Lightweight in-process request metrics.
 *
 * A prototype does not need Prometheus: counters here plus the connector and
 * workflow tables in Postgres answer every question the admin console asks.
 */
interface RouteStat {
  route: string;
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
}

const routes = new Map<string, RouteStat>();
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();

export function recordRequest(route: string, ms: number, statusCode: number): void {
  totalRequests += 1;
  if (statusCode >= 400) totalErrors += 1;

  const stat = routes.get(route) ?? { route, count: 0, errors: 0, totalMs: 0, maxMs: 0 };
  stat.count += 1;
  stat.totalMs += ms;
  stat.maxMs = Math.max(stat.maxMs, ms);
  if (statusCode >= 400) stat.errors += 1;
  routes.set(route, stat);
}

export function requestMetrics() {
  const top = [...routes.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map((s) => ({
      route: s.route,
      count: s.count,
      errors: s.errors,
      avgMs: Number((s.totalMs / s.count).toFixed(1)),
      maxMs: Number(s.maxMs.toFixed(1)),
    }));

  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    totalRequests,
    totalErrors,
    errorRate:
      totalRequests === 0 ? null : Number(((totalErrors / totalRequests) * 100).toFixed(2)),
    routes: top,
  };
}
