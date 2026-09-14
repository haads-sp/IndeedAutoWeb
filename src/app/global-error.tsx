'use client';

/**
 * The last-resort boundary, for an error in the root layout itself — which the ordinary
 * boundary cannot catch, because it renders inside that layout. It replaces the whole
 * document, so it renders its own <html> and <body> and imports its own styles.
 *
 * Classes, not `style={{…}}`: a style ATTRIBUTE in server-rendered HTML is inline style, which
 * the production Content-Security-Policy blocks (src/lib/security/csp.ts). Nonces cover
 * <style> and <script> elements, never attributes.
 *
 * Same rules as src/app/error.tsx: no error message, the digest only.
 */

import './globals.css';

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        {/* metadata exports are not supported here; React's <title> is the documented alternative. */}
        <title>Something went wrong</title>
        <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-8">
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="text-sm text-neutral-600">
            The site could not be loaded. The problem has been recorded.
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
      </body>
    </html>
  );
}
