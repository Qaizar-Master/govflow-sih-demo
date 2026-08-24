import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { env } from '@govflow/contracts';

/**
 * One Prisma client per process.
 *
 * Prisma 7 drops the Rust query engine in favour of a query compiler plus a
 * driver adapter, so the connection URL is handed to `PrismaPg` here rather
 * than declared in schema.prisma. The CLI reads the same variable through
 * prisma.config.ts, which keeps `db push`, the seed and the application pointed
 * at one database.
 *
 * The client is cached on globalThis so tsx watch reloads and Vitest module
 * re-evaluation do not exhaust the Postgres connection pool.
 */
const globalForPrisma = globalThis as unknown as { govflowPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({
    adapter,
    log: ['warn', 'error'],
  });
}

export const prisma: PrismaClient = globalForPrisma.govflowPrisma ?? createClient();

if (!env.isProduction) globalForPrisma.govflowPrisma = prisma;

export type { PrismaClient };
