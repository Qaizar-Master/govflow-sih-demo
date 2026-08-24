import { execSync } from 'node:child_process';

/**
 * Integration tests run against a dedicated, disposable `govflow_test` database
 * so they can never disturb the seeded demo data.
 *
 * The database is dropped and recreated before the suite rather than pushed
 * over. That keeps every run deterministic, and it means `prisma db push` acts
 * on an empty schema and so never needs `--accept-data-loss` - a flag Prisma 7
 * refuses to honour when it detects an AI agent in the environment.
 *
 * If Postgres is unreachable the suite still runs: the integration files detect
 * it and skip themselves, leaving the pure unit tests to pass anywhere.
 */
export const TEST_DATABASE_URL =
  'postgresql://govflow:govflow@localhost:5432/govflow_test?schema=public';

const ADMIN_URL = 'postgresql://govflow:govflow@localhost:5432/postgres';

/** Runs a psql statement, via a local client if present, otherwise the container. */
function psql(statement: string): void {
  try {
    execSync(`psql "${ADMIN_URL}" -v ON_ERROR_STOP=1 -c ${JSON.stringify(statement)}`, {
      stdio: 'pipe',
    });
  } catch {
    execSync(
      `docker exec govflow-postgres psql -U govflow -d postgres -v ON_ERROR_STOP=1 -c ${JSON.stringify(statement)}`,
      { stdio: 'pipe' },
    );
  }
}

export default async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';

  try {
    // FORCE terminates any connection left behind by a previous run.
    psql('DROP DATABASE IF EXISTS govflow_test WITH (FORCE)');
    psql('CREATE DATABASE govflow_test');
  } catch {
    console.warn(
      '[tests] could not reach Postgres - integration tests will skip.\n' +
        '        Start it with: npm run infra:up',
    );
    return;
  }

  try {
    execSync(`npx prisma db push --url "${TEST_DATABASE_URL}"`, {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
  } catch (error) {
    console.warn(
      '[tests] prisma db push against the test database failed',
      error instanceof Error ? error.message : error,
    );
  }
}
