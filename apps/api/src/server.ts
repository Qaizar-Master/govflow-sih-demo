import { env } from '@govflow/contracts';
import { closeQueues, createLogger, prisma } from '@govflow/core';
import { createApp } from './app.js';

const log = createLogger('api');

const app = createApp();

const server = app.listen(env.PORT, () => {
  log.info(`GovFlow API listening on :${env.PORT}`, {
    docs: `${env.API_BASE_URL}/docs`,
    aiConfigured: env.aiEnabled,
  });
  if (!env.aiEnabled) {
    log.warn('GEMINI_API_KEY is not set - validation will use the deterministic rule engine');
  }
});

async function shutdown(signal: string): Promise<void> {
  log.info(`received ${signal}, shutting down`);
  server.close();
  await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A dead department or a transient Redis blip must never take the API down.
process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
