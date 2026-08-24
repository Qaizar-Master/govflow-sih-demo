import { PrismaClient } from '@prisma/client';
import { env } from '@govflow/contracts';

/**
 * One Prisma client per process. Cached on globalThis so tsx watch reloads and
 * Vitest module re-evaluation do not exhaust the Postgres connection pool.
 */
const globalForPrisma = globalThis as unknown as { govflowPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.govflowPrisma ??
  new PrismaClient({
    log: env.isProduction ? ['warn', 'error'] : ['warn', 'error'],
    datasources: { db: { url: env.DATABASE_URL } },
  });

if (!env.isProduction) globalForPrisma.govflowPrisma = prisma;

export type { PrismaClient };
