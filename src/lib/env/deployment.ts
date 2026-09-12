/**
 * What is actually running.
 *
 * Lives in `src/lib/env/` because it reads `process.env`, which nothing else may do.
 *
 * This exists because of ISSUES.md row 1: every git-triggered deployment failed for
 * hours while `git push` succeeded, CI went green, and the site served 200s. None of
 * those three signals asserts that a deployment happened. The only thing that would have
 * caught it is comparing the deployed commit to the commit you pushed, and there was no
 * way to ask.
 *
 * Vercel injects these system variables into every build. They are not secrets — a commit
 * SHA identifies a revision of a private repository to someone who cannot read it.
 */

export interface DeploymentInfo {
  /** Full commit SHA of the deployed revision, or null when not built on Vercel. */
  readonly commit: string | null;
  /** Branch the deployment was built from. */
  readonly branch: string | null;
  /** 'production' | 'preview' | 'development' on Vercel; null locally. */
  readonly environment: string | null;
  /** Build timestamp, so a stale deployment is visible as well as identifiable. */
  readonly builtAt: string;
}

/**
 * NOTE: these are read at MODULE LOAD, which on Vercel happens at build time for values
 * Next inlines and at boot otherwise. Either way the value describes the build that is
 * serving the request, which is exactly the question being asked.
 */
const BUILT_AT = new Date().toISOString();

export function deploymentInfo(): DeploymentInfo {
  return {
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    environment: process.env.VERCEL_ENV ?? null,
    builtAt: BUILT_AT,
  };
}
