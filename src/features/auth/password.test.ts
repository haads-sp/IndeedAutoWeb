import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkBreachedPassword } from './breached-password';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePassword,
  validatePasswordShape,
} from './password';
import { DEFAULT_NEXT, safeNext } from './safe-redirect';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('password shape', () => {
  it('rejects anything shorter than the minimum', () => {
    const result = validatePasswordShape('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe('too_short');
  });

  it('accepts exactly the minimum', () => {
    expect(validatePasswordShape('a'.repeat(MIN_PASSWORD_LENGTH)).ok).toBe(true);
  });

  it('rejects absurdly long input, which is a CPU-exhaustion guard not a strength rule', () => {
    const result = validatePasswordShape('a'.repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.reason).toBe('too_long');
  });

  it('counts code points, not UTF-16 units', () => {
    // 11 emoji are 22 UTF-16 units. A naive `.length` check would let this through a
    // 12-character minimum while being far weaker than 12 characters implies.
    const elevenEmoji = '🔒'.repeat(11);
    expect(elevenEmoji.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(validatePasswordShape(elevenEmoji).ok).toBe(false);
  });

  it('imposes NO composition rules', () => {
    // BUILD-PLAN.md Stage 3 explicitly forbids rules that push users toward `Password1!`.
    // A long all-lowercase passphrase must pass.
    expect(validatePasswordShape('correct horse battery staple').ok).toBe(true);
  });
});

describe('breached password check', () => {
  /** HIBP returns `SUFFIX:COUNT` lines for the queried 5-character hash prefix. */
  function stubHibp(body: string, ok = true) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, text: async () => body }) as unknown as Response),
    );
  }

  it('flags a password whose hash suffix is in the range response', async () => {
    // SHA-1('password') = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    stubHibp('1E4C9B93F3F0682250B6CF8331B7EE68FD8:9999999\nAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:3');
    const result = await checkBreachedPassword('password');
    expect(result.status).toBe('breached');
    if (result.status === 'breached') expect(result.count).toBe(9999999);
  });

  it('passes a password absent from the range response', async () => {
    stubHibp('0000000000000000000000000000000000A:5\n0000000000000000000000000000000000B:2');
    expect((await checkBreachedPassword('a-passphrase-not-in-the-list')).status).toBe('safe');
  });

  it('ignores padding entries, which have a count of zero', async () => {
    // With Add-Padding, HIBP returns decoy suffixes at count 0. Treating one as a hit
    // would reject a perfectly good password.
    stubHibp('1E4C9B93F3F0682250B6CF8331B7EE68FD8:0');
    expect((await checkBreachedPassword('password')).status).toBe('safe');
  });

  it('reports unavailable, and does NOT report breached, when HIBP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    expect((await checkBreachedPassword('password')).status).toBe('unavailable');
  });

  it('reports unavailable on a non-2xx response', async () => {
    stubHibp('', false);
    expect((await checkBreachedPassword('password')).status).toBe('unavailable');
  });

  /** A fetch stub that records its arguments, typed so the call tuple is inspectable. */
  function spyFetch() {
    return vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        ({ ok: true, text: async () => '' }) as unknown as Response,
    );
  }

  it('never sends the password or its full hash — only the 5-character prefix', async () => {
    const spy = spyFetch();
    vi.stubGlobal('fetch', spy);

    await checkBreachedPassword('password');

    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6');

    // Only the first 5 of the 40 hash characters may leave this process.
    const sent = url.split('/range/')[1];
    expect(sent).toBe('5BAA6');
    expect(sent).toHaveLength(5);
    expect(url).not.toContain('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
  });

  it('does not put the password itself in the request', async () => {
    const spy = spyFetch();
    vi.stubGlobal('fetch', spy);

    // A distinctive value, so the assertion cannot pass by accident the way checking for
    // "password" would — the HIBP hostname itself contains that word.
    await checkBreachedPassword('zzq-unmistakable-passphrase-9417');

    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).not.toContain('zzq-unmistakable-passphrase-9417');
    expect(JSON.stringify(init ?? {})).not.toContain('zzq-unmistakable-passphrase-9417');
  });
});

describe('validatePassword fails open when HIBP is unreachable', () => {
  it('accepts the password but flags that the check did not run', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );

    const result = await validatePassword('a-long-enough-passphrase');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.breachCheckSkipped).toBe(true);
  });

  it('still rejects on shape before ever calling HIBP', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const result = await validatePassword('short');
    expect(result.ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('open-redirect guard', () => {
  it.each([
    ['//evil.com', 'protocol-relative'],
    ['/\\evil.com', 'backslash, normalised by some browsers'],
    ['https://evil.com', 'absolute'],
    ['evil.com', 'no leading slash'],
    ['', 'empty'],
    [null, 'absent'],
  ])('rejects %j (%s)', (input, _why) => {
    expect(safeNext(input as string | null)).toBe(DEFAULT_NEXT);
  });

  it('rejects a path containing control characters', () => {
    expect(safeNext('/portal\nSet-Cookie: x=1')).toBe(DEFAULT_NEXT);
  });

  it.each(['/portal', '/portal/settings', '/portal?tab=1'])('allows same-origin path %s', (input) => {
    expect(safeNext(input)).toBe(input);
  });
});

describe('boot assertion covers client-scoped variables too', () => {
  it('a required NEXT_PUBLIC_ variable is actually checked, not merely declared', async () => {
    const { requiredVars, assertPresent } = await import('@/lib/env/registry');

    const clientRequired = requiredVars('client').map((v) => v.name);
    expect(clientRequired.length).toBeGreaterThan(0);

    // With none of them set, the assertion must fail and name every one.
    let message = '';
    try {
      assertPresent('client', clientRequired, {});
    } catch (error) {
      message = (error as Error).message;
    }
    for (const name of clientRequired) {
      expect(message).toContain(name);
    }
  });
});
