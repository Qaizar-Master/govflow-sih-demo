/**
 * Imported first by every integration test so the Prisma client and the config
 * package bind to the test database rather than the demo one.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://govflow:govflow@localhost:5432/govflow_test?schema=public';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-for-govflow-suite';
// Must be set before @govflow/contracts parses the environment, otherwise the
// enqueue side would keep the default namespace and a development worker on the
// same Redis would consume the suite's jobs.
process.env.REDIS_QUEUE_PREFIX = 'govflow-test';
