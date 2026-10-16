// ---------------------------------------------------------------------------
// WORKER PROCESS  (Part VII; generalized in V2.5)
//
// Consumes the 'notifications' queue and dispatches by job type. In a real app
// each case would call an email provider (SendGrid/SES/Postmark); here we log
// what would be sent, including the action links for verification/reset.
// ---------------------------------------------------------------------------

import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { QUEUE_NAME } from './queue/notifications.js';

const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });

// In-memory idempotency guard (a real app would use a persistent "sent" record).
const alreadySent = new Set();

async function handle(job) {
  const { type } = job.data;
  const dedupe = `${type}:${job.id}`;
  logger.info(
    { jobId: job.id, type, attempt: job.attemptsMade + 1 },
    'processing notification',
  );

  if (alreadySent.has(dedupe)) {
    logger.info({ jobId: job.id }, 'already sent — skipping (idempotent)');
    return { skipped: true };
  }

  if (process.env.FORCE_FAIL === '1' && job.attemptsMade < 2) {
    throw new Error('simulated transient email-provider failure');
  }

  switch (type) {
    case 'booking.confirmation':
      logger.info(
        { bookingId: job.data.id },
        `EMAIL → booking confirmation for booking ${job.data.id}`,
      );
      break;
    case 'booking.reminder':
      logger.info(
        { bookingId: job.data.id },
        `EMAIL → reminder: your booking ${job.data.id} starts at ${job.data.startsAt}`,
      );
      break;
    case 'email.verification':
      logger.info(
        { to: job.data.email },
        `EMAIL → verify your address: ${config.APP_BASE_URL}/verify-email?token=${job.data.token}`,
      );
      break;
    case 'password.reset':
      logger.info(
        { to: job.data.email },
        `EMAIL → reset your password: ${config.APP_BASE_URL}/reset-password?token=${job.data.token}`,
      );
      break;
    default:
      logger.warn({ type }, 'unknown notification type');
  }

  alreadySent.add(dedupe);
  return { sent: true };
}

const worker = new Worker(QUEUE_NAME, handle, { connection, concurrency: 5 });

worker.on('completed', (job) => logger.info({ jobId: job.id }, 'job completed'));
worker.on('failed', (job, err) => {
  const attempt = job?.attemptsMade;
  const willRetry = attempt !== undefined && attempt < (job?.opts?.attempts ?? 1);
  logger.warn(
    { jobId: job?.id, err: err.message, attempt, willRetry },
    willRetry ? 'job failed — will retry' : 'job failed permanently (dead letter)',
  );
});

logger.info('Notifications worker started, waiting for jobs...');

async function shutdown(signal) {
  logger.info(`${signal} received — closing worker`);
  await worker.close();
  await connection.quit();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
