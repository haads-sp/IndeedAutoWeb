import { describe, expect, it } from 'vitest';

import { formatEvent, levelFor, scrub, sentryLogFor } from './event';
import { isCorrelationId } from '@/lib/request/correlation-header';

const ID = '3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c';
const NOW = new Date('2026-09-14T12:00:00.000Z');

describe('structured events', () => {
  it('emits one JSON object with the outcome name verbatim', () => {
    const line = formatEvent(
      { event: 'auth.sign_in', outcome: 'invalid_credentials', correlationId: ID, ip: '203.0.113.9' },
      NOW,
    );
    expect(JSON.parse(line)).toEqual({
      ts: '2026-09-14T12:00:00.000Z',
      level: 'warn',
      event: 'auth.sign_in',
      // The feature's enum value, not a paraphrase. One vocabulary end to end.
      outcome: 'invalid_credentials',
      correlationId: ID,
      userId: null,
      ip: '203.0.113.9',
    });
  });

  it('is a single line', () => {
    expect(formatEvent({ event: 'x', outcome: 'y', correlationId: ID }, NOW)).not.toContain('\n');
  });

  it.each([
    ['unavailable', 'error'],
    ['rate_limited', 'warn'],
    ['invalid_credentials', 'warn'],
    ['signed_in', 'info'],
    ['verification_sent', 'info'],
  ])('outcome %s is logged at level %s', (outcome, level) => {
    expect(levelFor(outcome)).toBe(level);
  });
});

describe('no personal data or secrets in logs', () => {
  it.each(['password', 'newPassword', 'access_token', 'refreshToken', 'authorization', 'cookie', 'apiKey', 'email', 'secret'])(
    'redacts the value under key %s',
    (key) => {
      expect(scrub({ [key]: 'sensitive-value' })).toEqual({ [key]: '[redacted]' });
    },
  );

  it('masks an email address hiding inside an innocent-looking field', () => {
    const clean = scrub({ note: 'failed for someone.name+tag@example.co.uk twice' });
    expect(clean?.note).toBe('failed for so***@example.co.uk twice');
    expect(JSON.stringify(clean)).not.toContain('someone.name');
  });

  it('does not redact harmless keys that merely contain similar letters', () => {
    expect(scrub({ passed: true, bypassCount: 2 })).toEqual({ passed: true, bypassCount: 2 });
  });

  it('the full line never carries a password passed in detail', () => {
    const line = formatEvent(
      { event: 'auth.sign_in', outcome: 'x', correlationId: ID, detail: { password: 'hunter2hunter2' } },
      NOW,
    );
    expect(line).not.toContain('hunter2');
  });
});

describe('correlation ids', () => {
  it('accepts a UUID', () => {
    expect(isCorrelationId(ID)).toBe(true);
  });

  it.each(['', 'abc', 'admin', '../../etc/passwd', `${ID}\ninjected: true`, null, undefined])(
    'rejects %j — a client-chosen value is never trusted as a correlation id',
    (value) => {
      expect(isCorrelationId(value as string | null | undefined)).toBe(false);
    },
  );
});

describe('what an event becomes in Sentry', () => {
  const record = {
    event: 'auth.sign_in',
    outcome: 'rate_limited',
    correlationId: ID,
    userId: '8a0d1e65-0000-4000-8000-000000000000',
    ip: '203.0.113.9',
    detail: { password: 'hunter2hunter2hunter2', note: 'for someone.name@example.com', retry: 30, gone: null },
  } as const;

  it('carries the outcome enum verbatim, at the same level as the log line', () => {
    const log = sentryLogFor(record);
    expect(log.level).toBe('warn');
    expect(log.message).toBe('auth.sign_in rate_limited');
    expect(log.attributes).toMatchObject({
      event: 'auth.sign_in',
      outcome: 'rate_limited',
      correlation_id: ID,
      user_id: record.userId,
      'detail.retry': 30,
    });
  });

  it('does NOT send the IP address — Sentry is told to collect no user information', () => {
    const serialised = JSON.stringify(sentryLogFor(record));
    expect(serialised).not.toContain('203.0.113.9');
  });

  it('sends detail through the same scrubbing as the log line', () => {
    const serialised = JSON.stringify(sentryLogFor(record));
    expect(serialised).not.toContain('hunter2hunter2hunter2');
    expect(serialised).not.toContain('someone.name@example.com');
  });

  it('drops null detail values rather than sending a type Sentry attributes do not accept', () => {
    expect(sentryLogFor(record).attributes).not.toHaveProperty('detail.gone');
  });
});
