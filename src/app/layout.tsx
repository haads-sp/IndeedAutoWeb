import type { Metadata } from 'next';
import { connection } from 'next/server';

import './globals.css';

export const metadata: Metadata = {
  // STUB (Stage 11): real title and description arrive with the landing page.
  title: 'IndeedAutoWeb',
  description: 'Account layer. Phase 1.',
};

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Every page renders per request. Deliberate, and required by the Content-Security-Policy
  // (src/lib/security/csp.ts): Next.js stamps each request's nonce onto its scripts while
  // rendering, and a page prerendered at build time has no request — its scripts would carry
  // no nonce and be blocked. Awaiting here, in the root layout, makes that true of every
  // route including the 404 page, rather than of whichever pages someone remembered.
  await connection();

  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
