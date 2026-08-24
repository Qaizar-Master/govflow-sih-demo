import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration.
 *
 * From v7 the connection URL no longer lives in schema.prisma: the CLI reads it
 * from here, and the runtime client receives a driver adapter instead (see
 * packages/core/src/db.ts). Keeping both in one place means `db push`, the seed
 * and the application all agree on which database they are talking to.
 *
 * The default below matches packages/contracts/src/env.ts. It exists because
 * `prisma generate` runs during the Docker image build, where no database is
 * reachable and none is needed - Prisma's own `env()` helper throws in that
 * situation, which would fail the build for no reason.
 */
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://govflow:govflow@localhost:5432/govflow?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',

  datasource: {
    url: DATABASE_URL,
  },

  migrations: {
    // Run by `prisma db push --force-reset` and `prisma migrate reset`.
    seed: 'tsx prisma/seed.ts',
  },
});
