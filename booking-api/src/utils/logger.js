// ---------------------------------------------------------------------------
// LOGGER  (Phase 1 → Part VIII: Logging & Observability)
//
// We use `pino` for STRUCTURED logging: every log line is a JSON object, not a
// free-form string. Why does that matter?
//
//   Free-form:  "user 42 failed login from 1.2.3.4"
//   Structured: {"level":"warn","msg":"failed login","userId":42,"ip":"1.2.3.4"}
//
// The structured version is *queryable*. In production you ship these JSON lines
// to a log aggregator and can ask "show me every failed login for userId 42" —
// no regex archaeology required. This is the difference between logging and
// observability from Part VIII.
//
// 12-Factor (Part XI): logs are an event STREAM. We write to stdout and let the
// runtime environment (Docker, systemd, k8s) handle routing/rotation. The app
// itself never manages log files.
// ---------------------------------------------------------------------------

import pino from 'pino';
import { config } from '../config/index.js';

const isDev = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.LOG_LEVEL,

  // In development, pretty-print for human eyes. In production, emit raw JSON to
  // stdout (faster, and what aggregators expect). Never pretty-print in prod.
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),

  // Redaction: never log secrets or credentials, even by accident (Part IX:
  // secure defaults). If any of these keys appear anywhere in a logged object,
  // pino replaces the value with [Redacted].
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      '*.password',
      'token',
      '*.token',
    ],
    censor: '[Redacted]',
  },
});
