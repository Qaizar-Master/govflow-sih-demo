import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { QUEUE_NAMES, env, workflowConfig } from '@govflow/contracts';
import { createLogger } from './logger.js';

const log = createLogger('queue');

/**
 * BullMQ requires maxRetriesPerRequest to be null on the shared ioredis
 * connection it uses for blocking commands.
 */
export const redisConnection: ConnectionOptions = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
} as ConnectionOptions;

export const defaultJobOptions: JobsOptions = {
  attempts: workflowConfig.maxAttempts,
  backoff: { type: 'exponential', delay: workflowConfig.backoffMs },
  removeOnComplete: { age: 3600, count: 500 },
  removeOnFail: { age: 86_400, count: 500 },
};

const globalForQueues = globalThis as unknown as {
  govflowWorkflowQueue?: Queue;
};

/**
 * The queue is created lazily and never at import time.
 *
 * A BullMQ Queue holds an open Redis connection that keeps the Node event loop
 * alive, which would stop short-lived consumers of this package - the seed
 * script and the test suite - from ever exiting.
 */
export function getWorkflowQueue(): Queue {
  if (!globalForQueues.govflowWorkflowQueue) {
    globalForQueues.govflowWorkflowQueue = new Queue(QUEUE_NAMES.WORKFLOW, {
      connection: redisConnection,
      prefix: env.REDIS_QUEUE_PREFIX,
      defaultJobOptions,
    });
  }
  return globalForQueues.govflowWorkflowQueue;
}

export interface StepJobData {
  applicationId: string;
  workflowInstanceId: string;
  stepType: string;
  /** Set when an officer/admin explicitly re-runs a failed step. */
  manualRetry?: boolean;
}

/** Enqueues one workflow step. The engine chains the next step on success. */
export async function enqueueStep(
  jobName: string,
  data: StepJobData,
  opts: JobsOptions = {},
): Promise<void> {
  await getWorkflowQueue().add(jobName, data, {
    ...defaultJobOptions,
    ...opts,
    jobId: undefined,
  });
  log.info('step enqueued', {
    jobName,
    applicationId: data.applicationId,
    stepType: data.stepType,
  });
}

export async function queueStats() {
  const counts = await getWorkflowQueue().getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  );
  return {
    name: QUEUE_NAMES.WORKFLOW,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}

export async function closeQueues(): Promise<void> {
  if (globalForQueues.govflowWorkflowQueue) {
    await globalForQueues.govflowWorkflowQueue.close();
    globalForQueues.govflowWorkflowQueue = undefined;
  }
}
