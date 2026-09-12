import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  ENV_REGISTRY,
  assertPresent,
  findMissing,
  requiredVars,
} from '@/lib/env/registry';

describe('env assertion', () => {
  it('names the missing variable in the error message', () => {
    expect(() => assertPresent('server', ['SUPABASE_SECRET_KEY'], {})).toThrowError(
      /SUPABASE_SECRET_KEY/,
    );
  });

  it('names EVERY missing variable, not just the first', () => {
    let message = '';
    try {
      assertPresent('server', ['SUPABASE_SECRET_KEY', 'UPSTASH_REDIS_REST_TOKEN'], {
        UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('SUPABASE_SECRET_KEY');
    expect(message).toContain('UPSTASH_REDIS_REST_TOKEN');
  });

  it('treats an empty string as missing, not as present', () => {
    expect(findMissing(['SUPABASE_SECRET_KEY'], { SUPABASE_SECRET_KEY: '' })).toEqual([
      'SUPABASE_SECRET_KEY',
    ]);
  });

  it('does not throw when every required variable is present', () => {
    expect(() =>
      assertPresent('server', ['SUPABASE_SECRET_KEY'], { SUPABASE_SECRET_KEY: 'sk-value' }),
    ).not.toThrow();
  });

  it('requires nothing at Stage 1 — the mechanism ships before the variables do', () => {
    expect(requiredVars('server')).toHaveLength(0);
    expect(requiredVars('client')).toHaveLength(0);
  });

  it('turns a variable on at the stage it is declared for', () => {
    // Guards the mechanism itself: a variable required from Stage 3 is inert at Stage 1.
    const stubbed = [{ name: 'X', scope: 'server', requiredFrom: 3, description: '' }] as const;
    const activeAt = (stage: number) =>
      stubbed.filter((v) => v.requiredFrom !== null && v.requiredFrom <= stage);

    expect(activeAt(1)).toHaveLength(0);
    expect(activeAt(3)).toHaveLength(1);
  });
});

describe('registry and .env.example agree', () => {
  const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const documented = new Set(
    example
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Z0-9_]+)=/)?.[1])
      .filter((name): name is string => name !== undefined),
  );

  it.each(ENV_REGISTRY.map((v) => v.name))('%s is listed in .env.example', (name) => {
    expect(documented.has(name)).toBe(true);
  });

  it('.env.example lists nothing the registry does not declare', () => {
    const declared = new Set(ENV_REGISTRY.map((v) => v.name));
    expect([...documented].filter((name) => !declared.has(name))).toEqual([]);
  });
});
