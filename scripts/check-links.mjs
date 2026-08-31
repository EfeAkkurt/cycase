#!/usr/bin/env node
/**
 * External link audit (delivery plan §4 Phase 4).
 *
 * A submission that links to a dead source is a submission whose licence and
 * research claims cannot be checked by a judge. Every external URL in the shipped
 * docs and the licence ledger is resolved for real.
 *
 * HEAD first, then GET for hosts that refuse HEAD. Exits non-zero on any dead link.
 * `--offline` skips the network and only reports what *would* be checked, so the
 * script is still useful in a sandbox without egress.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const OFFLINE = process.argv.includes('--offline');
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 6;

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'playwright-report',
  'test-results', '.assets-raw', 'output', '.claude',
]);

/** Hosts that are examples in the case fixture and must never be resolved. */
const FICTIONAL = [
  /cy-case\.corp/i, /cy-case-secure-id\.net/i, /sso-cycase-verify/i,
  /203\.0\.113\./, /example\.(com|org|net)/i, /localhost/, /127\.0\.0\.1/,
  // Placeholders in shell examples: `https://your-app...`. A `<host>` style
  // placeholder never reaches here — `<` is excluded from the URL charset above.
  /\byour-/i,
];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (['.md', '.html'].includes(extname(entry))) out.push(full);
  }
  return out;
}

const urls = new Map();
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/https?:\/\/[^\s)<>\]"'`]+/g)) {
    const url = match[0].replace(/[.,;:]+$/, '');
    if (FICTIONAL.some((pattern) => pattern.test(url))) continue;
    if (!urls.has(url)) urls.set(url, new Set());
    urls.get(url).add(relative(ROOT, file));
  }
}

const all = [...urls.keys()].sort();
console.log(`${all.length} distinct external URL(s) referenced.`);

if (OFFLINE) {
  for (const url of all) console.log(`  would check ${url}`);
  process.exit(0);
}

async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const response = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'user-agent': 'cycase-link-audit' },
      });
      clearTimeout(timer);
      if (response.ok || response.status === 403) return { url, status: response.status, ok: true };
      if (method === 'GET') return { url, status: response.status, ok: false };
    } catch (error) {
      if (method === 'GET') return { url, status: String(error.message ?? error), ok: false };
    }
  }
  return { url, status: 'unknown', ok: false };
}

const results = [];
for (let i = 0; i < all.length; i += CONCURRENCY) {
  results.push(...(await Promise.all(all.slice(i, i + CONCURRENCY).map(check))));
}

const dead = results.filter((result) => !result.ok);
for (const result of results) {
  console.log(`  ${result.ok ? 'ok  ' : 'DEAD'} ${result.status}  ${result.url}`);
}

if (dead.length > 0) {
  console.error(`\nLink audit FAILED: ${dead.length} dead link(s).`);
  for (const result of dead) {
    console.error(`  ${result.url} — referenced by ${[...urls.get(result.url)].join(', ')}`);
  }
  process.exit(1);
}

console.log(`\nLink audit clean: ${results.length} URL(s) resolve.`);
