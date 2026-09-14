/**
 * The correlation id header, shared by src/proxy.ts (which sets it) and the server code
 * that reads it.
 *
 * Not `server-only`, because proxy.ts imports it. Contains no secrets and no logic that
 * reads the environment.
 */

export const CORRELATION_HEADER = 'x-correlation-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a UUID is accepted as a correlation id. Anything else is treated as absent. */
export function isCorrelationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
