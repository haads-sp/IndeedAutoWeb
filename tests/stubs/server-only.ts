/**
 * Test stub for the `server-only` package.
 *
 * The real package throws on import outside a React Server Component build, which is
 * exactly what we want in the app and exactly what breaks a Vitest node-environment test
 * of a server module.
 *
 * **This does not weaken the guarantee.** The enforcer for "no server secret is reachable
 * from a 'use client' file" is `next build`, which fails outright on such an import. This
 * alias only affects unit tests, which are not a client bundle and cannot leak anything.
 */
export {};
