'use client';

/**
 * The error boundary. BUILD-PLAN.md Stage 10 and prohibition P3: "Never let a stack trace,
 * database error, or internal message reach a user."
 *
 * `error.message` is deliberately NOT rendered. In production Next.js replaces a Server
 * Component error's message with a generic one anyway, but that is Next's guarantee, not
 * ours — this page does not depend on it. The detail goes to Sentry, captured on the server
 * by onRequestError in src/instrumentation.ts.
 *
 * The digest IS shown. It is a hash, not a message: it reveals nothing, and instrumentation.ts
 * tags the Sentry event with the same value, so a person who quotes it can be matched to the
 * exact failure.
 *
 * `retry`, not `reset`: in Next.js 16 `retry()` re-fetches the segment from the server, while
 * `reset()` only clears the error state and re-renders what already failed.
 */

export default function ErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-neutral-600">
        This page could not be loaded. The problem has been recorded. Please try again in a
        moment.
      </p>
      {error.digest ? (
        <p className="text-xs text-neutral-500">
          Reference: <code className="select-all">{error.digest}</code>
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => retry()}
        className="rounded bg-neutral-900 px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
    </main>
  );
}
