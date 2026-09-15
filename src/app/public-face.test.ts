import { describe, expect, it } from 'vitest';

import { CURRENT_POLICIES, DATA_DELETION_POLICY } from '@/features/legal/policies';

import { llmsText } from './llms-text';
import { PRIVATE_PATHS, robotsRules } from './robots-rules';
import { SITE_DESCRIPTION, SITE_NAME } from './site';

describe('robots.txt', () => {
  it('production allows the public pages and asks crawlers to skip every private path', () => {
    const rules = robotsRules('production').rules;
    expect(rules).toEqual({ userAgent: '*', allow: '/', disallow: [...PRIVATE_PATHS] });
  });

  it.each(['/auth/', '/portal', '/api/', '/accept-terms'])('%s is disallowed in production', (path) => {
    expect((robotsRules('production').rules as { disallow: string[] }).disallow).toContain(path);
  });

  it.each([['preview'], ['development'], [null]])('%s disallows everything', (environment) => {
    expect(robotsRules(environment).rules).toEqual({ userAgent: '*', disallow: '/' });
  });
});

describe('llms.txt', () => {
  const text = llmsText((path) => `https://www.alsayeed.ca${path}`);

  it('starts with the site name and the one-line summary, per the llms.txt format', () => {
    expect(text.startsWith(`# ${SITE_NAME}\n\n> ${SITE_DESCRIPTION}\n`)).toBe(true);
  });

  it.each(['/', '/signup', '/login', '/forgot-password'])('links %s with an absolute URL', (path) => {
    expect(text).toContain(`(https://www.alsayeed.ca${path})`);
  });

  it('describes every policy as a placeholder, with its version', () => {
    for (const policy of [CURRENT_POLICIES.terms, CURRENT_POLICIES.privacy, DATA_DELETION_POLICY]) {
      expect(text).toContain(
        `[${policy.title}](https://www.alsayeed.ca${policy.path}): Placeholder, pending review by a lawyer. Version ${policy.version}.`,
      );
    }
  });

  it('never lists a private page', () => {
    for (const path of PRIVATE_PATHS) {
      expect(text).not.toContain(`https://www.alsayeed.ca${path}`);
    }
  });
});

describe("the public face says nothing about the product (the owner's decision)", () => {
  it.each([
    ['the site name', SITE_NAME],
    ['the site description', SITE_DESCRIPTION],
    ['llms.txt', llmsText((path) => path)],
  ])('%s does not name the planned product, the job site, or its trademark', (_label, text) => {
    expect(text).not.toMatch(/indeed|job|apply|application|automat|claude|\bAI\b/i);
  });
});
