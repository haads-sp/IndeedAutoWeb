import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCANNER = fileURLToPath(new URL('../scripts/secret-scan.mjs', import.meta.url));

/**
 * The fake secrets are ASSEMBLED AT RUNTIME rather than written as literals, because the
 * scanner scans `tests/` — a literal here would make this file its own first hit.
 *
 * The planted tree is generated in the OS temp directory and deleted afterwards. Nothing
 * fake is ever committed: a committed fake would be flagged by gitleaks' history scan
 * forever and could trip GitHub's own secret scanning.
 */
const FAKE_KEY = `sb_${'secret'}_${'A1b2C3d4E5f6G7h8'}${'J9k0L1m2'}`;
const FAKE_PUBLIC_VAR = `NEXT_PUBLIC_${'SERVICE'}_${'ROLE'}_KEY`;

let root: string;

/** Runs the scanner against `dir`. @returns its exit code and combined output. */
function runScanner(dir: string): { code: number; output: string } {
  try {
    const stdout = execFileSync(process.execPath, [SCANNER, dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    const err = error as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'secret-scan-'));
  mkdirSync(join(root, 'src', 'lib'), { recursive: true });
  mkdirSync(join(root, 'docs'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('secret-scan', () => {
  it('exits 0 on a clean tree', () => {
    writeFileSync(join(root, 'src', 'lib', 'ok.ts'), 'export const answer = 42;\n');

    const { code, output } = runScanner(root);

    expect(code).toBe(0);
    expect(output).toContain('clean');
  });

  it('exits 1 and names the file when a key-shaped secret is planted', () => {
    writeFileSync(join(root, 'src', 'lib', 'leak.ts'), `export const key = '${FAKE_KEY}';\n`);

    const { code, output } = runScanner(root);

    expect(code).toBe(1);
    expect(output).toContain('src/lib/leak.ts');
  });

  it('exits 1 and names the file when a secret hides behind a public prefix', () => {
    writeFileSync(join(root, '.env.example'), `${FAKE_PUBLIC_VAR}=\n`);

    const { code, output } = runScanner(root);

    expect(code).toBe(1);
    expect(output).toContain('.env.example');
  });

  it('names BOTH offending files when both kinds are planted', () => {
    writeFileSync(join(root, 'src', 'lib', 'leak.ts'), `export const key = '${FAKE_KEY}';\n`);
    writeFileSync(join(root, '.env.example'), `${FAKE_PUBLIC_VAR}=\n`);

    const { code, output } = runScanner(root);

    expect(code).toBe(1);
    expect(output).toContain('src/lib/leak.ts');
    expect(output).toContain('.env.example');
  });

  it('reports the line number of the hit', () => {
    writeFileSync(
      join(root, 'src', 'lib', 'leak.ts'),
      `const a = 1;\nconst b = 2;\nexport const key = '${FAKE_KEY}';\n`,
    );

    const { output } = runScanner(root);

    expect(output).toContain('src/lib/leak.ts:3');
  });

  it('does NOT flag the bare prefix, which appears in this repo\'s own prose', () => {
    // Finding B: matching the bare prefix makes CI red on the first commit and forever
    // after, because CLAUDE.md and docs/SECRETS.md both name it. Only a key-SHAPED value
    // is a finding.
    writeFileSync(
      join(root, 'src', 'lib', 'prose.ts'),
      `// Supabase keys look like sb_${'secret'}_… and must never be committed.\n`,
    );

    const { code } = runScanner(root);

    expect(code).toBe(0);
  });

  it('ignores docs/, because prose about secrets is not a secret', () => {
    writeFileSync(join(root, 'docs', 'SECRETS.md'), `Example value: ${FAKE_KEY}\n`);

    const { code } = runScanner(root);

    expect(code).toBe(0);
  });
});
