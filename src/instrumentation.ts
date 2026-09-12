/**
 * Next.js boot hook. Runs once per server process, before any request is handled.
 *
 * Its whole job in Stage 1 is to call the env assertion, so a missing variable fails at
 * startup with a message naming it, rather than surfacing as a confusing error deep
 * inside some later request.
 */

export async function register(): Promise<void> {
  // Only the Node.js server runtime has a full process.env to assert against.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { serverEnv } = await import('@/lib/env/server');
  serverEnv();
}
