/**
 * Loading state. BUILD-PLAN.md Stage 10: "Loading, error, and empty states for every route that
 * fetches." Shown while the session and data are fetched on the server. It renders no content
 * that depends on who the user is, so it cannot flash one user's data at another.
 */
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-3 p-8" aria-busy="true">
      <div className="h-5 w-32 animate-pulse rounded bg-neutral-200" />
      <div className="h-4 w-full animate-pulse rounded bg-neutral-100" />
      <div className="h-4 w-2/3 animate-pulse rounded bg-neutral-100" />
      <span className="sr-only">Loading</span>
    </main>
  );
}
