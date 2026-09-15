import type { Metadata } from 'next';
import { connection } from 'next/server';

import './globals.css';

import { SITE_DESCRIPTION, SITE_NAME } from './site';

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
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
