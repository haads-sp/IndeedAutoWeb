import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * BUILD-PLAN.md Stage 6: "Verify the secret key is used in exactly the places it must be,
 * and nowhere else."
 *
 * Today that set is EMPTY. The secret key carries Postgres `BYPASSRLS` — it skips every
 * policy, including the ones Stage 6 exists to prove. Nothing in this application has
 * needed to act as no one, so nothing holds it, and the variable is not even set.
 *
 * This is a test rather than a note in a document because "we checked once" decays. If a
 * future stage genuinely needs the secret key, this test fails and whoever adds it has to
 * come here and say where it now lives and why — which is the conversation that should
 * happen, rather than a client quietly appearing with BYPASSRLS in it.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url));

const SECRET_KEY = 'SUPABASE_SECRET_KEY';

/**
 * The only modules permitted to name the secret key at all. Both merely DECLARE it:
 * the registry lists every variable this app knows about, and env/server.ts reads the
 * environment. Neither constructs a client with it.
 */
const ALLOWED_TO_MENTION = ['lib/env/registry.ts', 'lib/env/server.ts'];

/** Anything that builds a Supabase client. None may be handed the secret key. */
const CLIENT_FACTORIES = ['createServerClient', 'createBrowserClient', 'createClient'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const sourceFiles = walk(SRC)
  .filter((f) => /\.(ts|tsx)$/.test(f))
  .map((f) => ({
    // Normalise to forward slashes so the assertions read the same on Windows and Linux.
    path: f.slice(SRC.length + 1).split('\\').join('/'),
    text: readFileSync(f, 'utf8'),
  }));

describe('the secret key is used in exactly the places it must be, and nowhere else', () => {
  it('found source files to inspect', () => {
    // Guards against the whole suite passing because the walk returned nothing.
    expect(sourceFiles.length).toBeGreaterThan(10);
  });

  it('is mentioned only by the modules that declare it', () => {
    const mentions = sourceFiles
      .filter(({ text }) => text.includes(SECRET_KEY))
      .map(({ path }) => path)
      .filter((path) => !ALLOWED_TO_MENTION.includes(path))
      // Comments explaining why it is absent are not usages.
      .filter((path) => {
        const file = sourceFiles.find((f) => f.path === path)!;
        return file.text
          .split('\n')
          .some(
            (line) =>
              line.includes(SECRET_KEY) && !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'),
          );
      });

    expect(mentions, `unexpected reference to ${SECRET_KEY} in: ${mentions.join(', ')}`).toEqual([]);
  });

  it('is never passed to a Supabase client factory', () => {
    const offenders = sourceFiles.filter(({ text }) =>
      CLIENT_FACTORIES.some((factory) => {
        const call = text.indexOf(`${factory}(`);
        if (call === -1) return false;
        // Look at the call's arguments, not the whole file.
        return text.slice(call, call + 400).includes(SECRET_KEY);
      }),
    );

    expect(
      offenders.map((f) => f.path),
      'a Supabase client is being constructed with the BYPASSRLS key',
    ).toEqual([]);
  });

  it('no client is built from a service_role key either', () => {
    // The retired name for the same thing. BUILD-PLAN.md §4.1 forbids it outright, and a
    // rename is not a reason for the check to stop working.
    const offenders = sourceFiles
      .filter(({ text }) => /service_role/i.test(text))
      .map((f) => f.path);

    expect(offenders).toEqual([]);
  });

  it('the publishable key is what the client factories receive', () => {
    // The positive half: not merely "no secret key" but "the right key". A factory called
    // with neither would fail this.
    const clientModule = sourceFiles.find((f) => f.path === 'lib/supabase/client.ts');
    const serverModule = sourceFiles.find((f) => f.path === 'lib/supabase/server.ts');

    expect(clientModule?.text).toContain('publishableKey');
    expect(serverModule?.text).toContain('publishableKey');
  });
});
