import { execSync } from 'node:child_process';

/**
 * Integration tests run against a dedicated `govflow_test` database so they can
 * never disturb the seeded demo data. If Postgres is not reachable the suite
 * still runs - the integration files detect it and skip themselves, leaving the
 * pure unit tests to pass on any machine.
 */
const ADMIN_URL = 'postgresql://govflow:govflow@localhost:5432/postgres';
export const TEST_DATABASE_URL =
  'postgresql://govflow:govflow@localhost:5432/govflow_test?schema=public';

export default async function setup(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';

  try {
    execSync(
      `psql "${ADMIN_URL}" -tc "SELECT 1 FROM pg_database WHERE datname='govflow_test'" | grep -q 1 || psql "${ADMIN_URL}" -c "CREATE DATABASE govflow_test"`,
      { stdio: 'pipe', shell: '/bin/bash' },
    );
  } catch {
    // psql may not be installed on the host; fall back to the docker container.
    try {
      execSync(
        `docker exec govflow-postgres psql -U govflow -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='govflow_test'" | grep -q 1 || docker exec govflow-postgres psql -U govflow -d postgres -c "CREATE DATABASE govflow_test"`,
        { stdio: 'pipe', shell: '/bin/bash' },
      );
    } catch {
      console.warn(
        '[tests] could not create govflow_test database - integration tests will skip',
      );
      return;
    }
  }

  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
  } catch (error) {
    console.warn('[tests] prisma db push against the test database failed', error);
  }
}
