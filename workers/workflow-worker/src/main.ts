import { Worker, type Job } from 'bullmq';
import { QUEUE_NAMES, env, workflowConfig, type StepType } from '@govflow/contracts';
import {
  closeQueues,
  createLogger,
  prisma,
  redisConnection,
  runStep,
  type StepJobData,
} from '@govflow/core';

/**
 * GOVFLOW WORKFLOW WORKER
 * ---------------------------------------------------------------------------
 * Consumes workflow step jobs so departmental calls never block an HTTP
 * request. Each job runs exactly one step; the engine persists the outcome and
 * enqueues the next step itself, which keeps the chain restartable from the
 * database alone.
 *
 * Retry behaviour lives with BullMQ: when the engine reports RETRY we re-throw,
 * BullMQ applies exponential backoff, and the attempt counter the officer sees
 * is the real one.
 */
const log = createLogger('worker');

const worker = new Worker<StepJobData>(
  QUEUE_NAMES.WORKFLOW,
  async (job: Job<StepJobData>) => {
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? workflowConfig.maxAttempts;

    log.info('processing step', {
      job: job.name,
      applicationId: job.data.applicationId,
      stepType: job.data.stepType,
      attempt,
      maxAttempts,
    });

    const outcome = await runStep({
      applicationId: job.data.applicationId,
      stepType: job.data.stepType as StepType,
      attempt,
      maxAttempts,
    });

    if (outcome.result === 'RETRY') {
      // Hand control back to BullMQ so the backoff schedule applies.
      throw outcome.error;
    }

    log.info('step finished', {
      applicationId: job.data.applicationId,
      stepType: job.data.stepType,
      result: outcome.result,
      ...(outcome.result === 'COMPLETED' ? { nextStep: outcome.nextStep } : {}),
    });

    return outcome;
  },
  {
    connection: redisConnection,
    prefix: env.REDIS_QUEUE_PREFIX,
    concurrency: 4,
    // Keep a short window of history so the admin queue view is meaningful.
    removeOnComplete: { age: 3600, count: 200 },
    removeOnFail: { age: 86_400, count: 200 },
  },
);

worker.on('failed', (job, error) => {
  log.warn('job failed', {
    job: job?.name,
    applicationId: job?.data?.applicationId,
    stepType: job?.data?.stepType,
    attemptsMade: job?.attemptsMade,
    message: error.message,
  });
});

worker.on('error', (error) => {
  log.error('worker error', { message: error.message });
});

worker.on('ready', () => {
  log.info('worker ready', {
    queue: QUEUE_NAMES.WORKFLOW,
    redis: env.REDIS_URL.replace(/\/\/.*@/, '//***@'),
    maxAttempts: workflowConfig.maxAttempts,
    backoffMs: workflowConfig.backoffMs,
  });
});

async function shutdown(signal: string): Promise<void> {
  log.info(`received ${signal}, draining worker`);
  await worker.close();
  await Promise.allSettled([closeQueues(), prisma.$disconnect()]);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
  });
});
