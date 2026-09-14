import 'server-only';

import * as Sentry from '@sentry/nextjs';

/**
 * Structured events.
 *
 * BUILD-PLAN.md Stage 9: "Structured events carry a correlation ID. Any operation with more
 * than two outcomes gets an outcome enum, and those exact names are used in logs, in Sentry
 * grouping, and in user-facing copy. One vocabulary end to end."
 *
 * So `outcome` is always the feature's own enum value — `invalid_credentials`,
 * `rate_limited`, `verification_sent` — never a paraphrase. The same string keys the
 * user-facing message, and keys Sentry grouping.
 *
 * Two destinations:
 *   - One JSON object per line on stdout, which is what Vercel captures as runtime logs.
 *     Vercel keeps those briefly.
 *   - Sentry Logs, where they are durable (Stage 10). Failed sign-ins and rate-limit hits leave
 *     no row in any auth table, so this is their only lasting record. An outcome that means
 *     something broke on OUR side is also raised as a Sentry issue, grouped by the enum.
 *
 * **No email addresses, passwords or tokens, ever.** Callers should not pass them, and
 * scrub() removes them anyway — a logging line is not a place to rely on every caller
 * remembering.
 */

export interface EventRecord {
  /** Dotted name of what was attempted, e.g. 'auth.sign_in'. */
  readonly event: string;
  /** The feature's outcome enum value, verbatim. */
  readonly outcome: string;
  readonly correlationId: string;
  readonly userId?: string | null;
  readonly ip?: string | null;
  readonly detail?: Readonly<Record<string, string | number | boolean | null>>;
}

type Level = 'info' | 'warn' | 'error';

/** Outcomes that mean something went wrong on our side, not the user's. */
const ERROR_OUTCOMES = new Set(['unavailable']);
/** Outcomes worth attention in aggregate: throttling and refusals. */
const WARN_OUTCOMES = new Set(['rate_limited', 'wrong_password', 'invalid_credentials']);

export function levelFor(outcome: string): Level {
  if (ERROR_OUTCOMES.has(outcome)) return 'error';
  if (WARN_OUTCOMES.has(outcome)) return 'warn';
  return 'info';
}

const SENSITIVE_KEY = /password|passwd|secret|token|authorization|cookie|api[-_]?key|email/i;
const EMAIL = /([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/**
 * Removes values under sensitive-looking keys, and masks any email address that appears
 * inside other values. Exported so it can be tested directly.
 */
export function scrub(
  detail: EventRecord['detail'],
): Record<string, string | number | boolean | null> | undefined {
  if (!detail) return undefined;

  const clean: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_KEY.test(key)) {
      clean[key] = '[redacted]';
    } else if (typeof value === 'string') {
      clean[key] = value.replace(EMAIL, '$1***@$2');
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/** Serialises one event. Separated from the write so the exact line can be tested. */
export function formatEvent(record: EventRecord, now: Date = new Date()): string {
  return JSON.stringify({
    ts: now.toISOString(),
    level: levelFor(record.outcome),
    event: record.event,
    outcome: record.outcome,
    correlationId: record.correlationId,
    userId: record.userId ?? null,
    ip: record.ip ?? null,
    ...(record.detail ? { detail: scrub(record.detail) } : {}),
  });
}

export interface SentryLog {
  readonly level: Level;
  readonly message: string;
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

/**
 * What an event becomes in Sentry. Separated from the send, like formatEvent, so the exact
 * payload can be tested without a DSN.
 *
 * The IP address is deliberately NOT sent. It stays in the short-lived platform log line,
 * where it serves rate-limit investigation; Sentry is told to collect no user information
 * (dataCollection.userInfo: false), and sending it here by hand would quietly undo that.
 */
export function sentryLogFor(record: EventRecord): SentryLog {
  const attributes: Record<string, string | number | boolean> = {
    event: record.event,
    outcome: record.outcome,
    correlation_id: record.correlationId,
  };
  if (record.userId) attributes.user_id = record.userId;

  for (const [key, value] of Object.entries(scrub(record.detail) ?? {})) {
    if (value !== null) attributes[`detail.${key}`] = value;
  }

  return {
    level: levelFor(record.outcome),
    message: `${record.event} ${record.outcome}`,
    attributes,
  };
}

export function logEvent(record: EventRecord): void {
  const line = formatEvent(record);
  const level = levelFor(record.outcome);
  // One line, one object. console.error/warn so platform log filters by level work.
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  // Without a DSN Sentry was never initialised, and both calls below are no-ops.
  const log = sentryLogFor(record);
  Sentry.logger[log.level](log.message, log.attributes);

  if (level === 'error') {
    Sentry.captureMessage(log.message, {
      level: 'error',
      // Grouped by the outcome enum itself, not by message text or stack: BUILD-PLAN.md
      // Stage 9, "those exact names are used in logs, in Sentry grouping, and in user-facing
      // copy."
      fingerprint: [record.event, record.outcome],
      tags: { event: record.event, outcome: record.outcome, correlation_id: record.correlationId },
    });
  }
}
