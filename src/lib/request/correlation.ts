import 'server-only';

/**
 * The current request's correlation id.
 *
 * src/proxy.ts generates one per request and OVERWRITES any value the client sent. An id
 * a client can choose is an id a client can use to make their requests look like part of
 * someone else's trail in the logs.
 */

import { headers } from 'next/headers';

import { CORRELATION_HEADER, isCorrelationId } from './correlation-header';

export async function correlationId(): Promise<string> {
  const value = (await headers()).get(CORRELATION_HEADER);
  if (isCorrelationId(value)) return value;

  // A route the proxy does not cover. Still return a real, unique id rather than a
  // shared placeholder — a constant would merge unrelated requests into one trail.
  return crypto.randomUUID();
}
