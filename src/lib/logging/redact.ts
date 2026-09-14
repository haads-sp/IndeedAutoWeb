/**
 * Redaction for anything that leaves this process: log lines and Sentry events.
 *
 * Pure, with no `server-only` import, so the same rules apply wherever they are used and
 * can be tested exhaustively. BUILD-PLAN.md Stage 10: "no tokens, emails, or passwords in
 * captured events."
 *
 * This is DEFENCE IN DEPTH, not the primary control. Sentry is configured to collect as
 * little as possible in the first place (src/lib/observability/sentry-options.ts). This
 * runs anyway, because a scrubber that only has to be right when the configuration is
 * wrong is exactly the one you want to exist.
 */

const REDACTED = '[redacted]';

/** Keys whose VALUES are never sent, whatever they contain. */
const SENSITIVE_KEY =
  /password|passwd|secret|token|authorization|cookie|api[-_]?key|email|session|set-cookie|x-forwarded-for|x-real-ip|x-vercel-forwarded-for/i;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // A JWT: three base64url segments, the first starting "eyJ" ({"). Session tokens.
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[jwt]'],
  // Supabase keys, publishable or secret.
  [/sb_(?:secret|publishable)_[A-Za-z0-9_-]{8,}/g, '[supabase-key]'],
  // Any email address, masked rather than removed so the domain stays useful.
  [/([A-Za-z0-9._%+-]{1,2})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2'],
  // Credential-bearing query parameters, however the surrounding URL was captured.
  [/([?&](?:token_hash|token|code|access_token|refresh_token|password|email)=)[^&#\s"']*/gi, '$1[redacted]'],
];

/** Redacts sensitive substrings inside a single string. */
export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** Removes the query string and fragment from a URL, keeping origin and path. */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/**
 * Deep-redacts any JSON-like value: sensitive keys have their values replaced, and every
 * string anywhere is passed through redactString. Cycles are tolerated.
 */
export function redactDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === 'string') return redactString(value) as T;
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value as object)) return value;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, seen)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactDeep(inner, seen);
  }
  return out as T;
}
