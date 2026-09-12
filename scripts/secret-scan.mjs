#!/usr/bin/env node
/**
 * Secret scanner — the local half of prohibition P1.
 *
 * One cross-platform Node script so Windows and CI run the identical check. CI also runs
 * gitleaks and the literal greps from BUILD-PLAN.md §1b; this is the one that developers
 * run before pushing.
 *
 * Usage:  node scripts/secret-scan.mjs [targetDir]
 * Exits 1 and prints `file:line` for every hit; exits 0 on a clean tree.
 *
 * Two deliberate departures from BUILD-PLAN.md §1b, both explained in docs/DOMAIN.md:
 *
 *  1. The key pattern matches a key-SHAPED VALUE (`sb_secret_` + 16 or more key
 *     characters), not the bare prefix. The bare prefix appears in this file, in
 *     CLAUDE.md, in docs/SECRETS.md and in BUILD-PLAN.md itself, so a prefix match is red
 *     on the first commit and stays red forever — which teaches everyone to ignore it.
 *  2. `docs/` is excluded, because prose about secrets is not a secret.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve, extname, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Directories scanned when they exist. */
const SCAN_DIRS = ['src', 'scripts', 'public', '.github', 'tests', 'supabase', '.next'];

/** Root-level files scanned when they exist. */
const SCAN_ROOT_FILES = [
  '.env.example',
  'next.config.ts',
  'next.config.js',
  'next.config.mjs',
  'eslint.config.mjs',
  'postcss.config.mjs',
  'vitest.config.mts',
  'tsconfig.json',
  'package.json',
  'AGENTS.md',
  '.gitleaks.toml',
];

/** Never descend into these. `docs/` holds prose about secrets, which is not a secret. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', 'docs', 'cache', '.turbo', 'coverage']);

/** Binary-ish files have nothing to match and blow up memory. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.zip', '.gz', '.tar', '.mp4', '.webm', '.mp3', '.wasm',
]);

const MAX_FILE_BYTES = 4 * 1024 * 1024;

const PATTERNS = [
  {
    name: 'secret behind a public prefix',
    // A NEXT_PUBLIC_ variable whose name admits it carries a secret.
    regex: /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE)/,
  },
  {
    name: 'committed Supabase secret key',
    // A key-SHAPED value, not the bare prefix. See the header comment.
    regex: /sb_secret_[A-Za-z0-9_-]{16,}/,
  },
];

/** @returns {string[]} every scannable file path under `root`. */
function collectFiles(root) {
  const found = [];

  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile()) {
        if (BINARY_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
        found.push(full);
      }
    }
  };

  for (const dir of SCAN_DIRS) {
    const full = join(root, dir);
    if (existsSync(full)) walk(full);
  }
  for (const file of SCAN_ROOT_FILES) {
    const full = join(root, file);
    if (existsSync(full)) found.push(full);
  }

  return found;
}

/** @returns {{file: string, line: number, pattern: string, text: string}[]} */
export function scan(root) {
  const hits = [];

  for (const file of collectFiles(root)) {
    let size;
    try {
      size = statSync(file).size;
    } catch {
      continue;
    }
    if (size > MAX_FILE_BYTES) continue;

    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      for (const { name, regex } of PATTERNS) {
        const match = regex.exec(lines[i]);
        if (match !== null) {
          hits.push({
            file: relative(root, file).split(sep).join('/'),
            line: i + 1,
            pattern: name,
            text: match[0],
          });
        }
      }
    }
  }

  return hits;
}

function main() {
  const root = resolve(process.argv[2] ?? process.cwd());
  const hits = scan(root);

  if (hits.length === 0) {
    console.log(`secret-scan: clean (${basename(root)})`);
    return 0;
  }

  console.error(`secret-scan: ${hits.length} potential secret(s) found\n`);
  for (const hit of hits) {
    console.error(`  ${hit.file}:${hit.line}  [${hit.pattern}]  ${hit.text}`);
  }
  console.error('\nNothing matching these patterns may be committed. See docs/SECRETS.md.');
  return 1;
}

// Only run when invoked directly, so the test can import `scan` without exiting.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
