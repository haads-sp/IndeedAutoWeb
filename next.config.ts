import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';

/**
 * Security headers that do not vary per request. BUILD-PLAN.md Stage 10.
 *
 * The Content-Security-Policy is NOT here for pages: it carries a per-request nonce, so it is
 * set in src/proxy.ts. Setting a second CSP here as well would not be ignored — a browser
 * enforces every CSP it receives, as an intersection — so page CSP lives in exactly one place.
 */
const securityHeaders = [
  // Vercel already sends max-age=63072000 on custom domains. Stated here too, so the
  // guarantee does not depend on a platform default we did not set. No `preload`: joining the
  // browser preload list is effectively irreversible, and that is a decision for the owner.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Clickjacking. frame-ancestors 'none' in the CSP does the same for modern browsers; this
  // covers the ones that predate it.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Only the origin crosses sites, never a path or query string — /auth/confirm URLs carry a
  // single-use token.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  // "X-Powered-By: Next.js" tells an attacker which framework's CVEs to try first.
  poweredByHeader: false,

  // Stated, not defaulted. With Turbopack, withSentryConfig switches browser source maps ON when
  // this is unset, then relies on its own post-upload step to delete them. There is no browser
  // Sentry to use them (docs/DECISIONS.md), so they are simply never generated, and nothing
  // depends on a cleanup step running. Server source maps are unaffected and are never served.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      {
        // API responses carry no scripts, styles or frames, so they get the strictest policy
        // there is. src/proxy.ts does not run on /api, so this never overlaps the page CSP.
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'none'" }],
      },
    ];
  },
};

const config = withSentryConfig(nextConfig, {
  // Build-time only, for uploading SERVER source maps so stack traces in Sentry are readable.
  // All three absent in CI and locally, where upload is skipped. SENTRY_AUTH_TOKEN is a Vercel
  // SECRET; org and project are not secret. docs/SECRETS.md.
  //
  // Read from process.env directly: this file runs before the application exists, so it cannot
  // use src/lib/env. The variables are still declared in the registry and .env.example.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
});

// withSentryConfig also turns on experimental.clientTraceMetadata, which renders
// <meta name="baggage"> and <meta name="sentry-trace"> into every page so a BROWSER Sentry can
// continue the server's trace. There is no browser Sentry, and that baggage carries the DSN's
// public key and the Sentry org id — the very values SENTRY_DSN is kept server-side to keep out
// of page source. So it is switched back off.
if (config.experimental) {
  delete config.experimental.clientTraceMetadata;
}

export default config;
