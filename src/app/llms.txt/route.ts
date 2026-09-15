import { absoluteUrl } from '@/lib/env/site-url';

import { llmsText } from '../llms-text';

/** Served as /llms.txt. The content, and why it says so little, are in ../llms-text.ts. */
export function GET(): Response {
  return new Response(llmsText(absoluteUrl), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
