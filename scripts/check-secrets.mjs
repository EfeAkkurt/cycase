#!/usr/bin/env node
/**
 * Secret scan (delivery plan §4 Phase 4, §9).
 *
 * Two separate questions, because they fail differently:
 *   1. does a secret sit in the *source tree*;
 *   2. does a secret reach the *built client bundle* — which is the one that
 *      actually leaks, and the one a source-only scan cannot see.
 *
 * Exits non-zero on any finding. Scripts that only warn are decorations.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();

/** Patterns that indicate a real credential, not a variable named "token". */
const PATTERNS = [
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI project key', re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: 'postgres URL with password', re: /\bpostgres(?:ql)?:\/\/[^\s:@/]+:[^\s@/]+@/ },
  { name: 'assigned secret literal', re: /\b(?:api[_-]?key|secret|password|passwd|private[_-]?key)\s*[:=]\s*['"][^'"\s${}]{12,}['"]/i },
];

/** Directories that are never ours to police. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'coverage', 'playwright-report',
  'test-results', '.assets-raw', 'output', '.claude', '.playwright-cli',
]);

/** Binary and generated files a text scan cannot meaningfully read. */
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.glb', '.gltf', '.bin', '.woff2', '.woff',
  '.mp3', '.wav', '.webm', '.mp4', '.ico', '.pdf', '.zip', '.tsbuildinfo',
]);

/**
 * An explicit, auditable exception.
 *
 * Some tests must contain a credential-shaped string in order to prove that
 * redaction removes it — a suite that cannot say the word cannot test the rule.
 * Rather than weakening the pattern globally, each such line carries this marker,
 * so every exception is visible at the site a reviewer would look.
 */
const ALLOW_MARKER = 'secret-scan-allow';

/** A line that is demonstrably documentation about a secret, not a secret. */
function isDocumentation(line) {
  return /placeholder|example|your[_-]?key|<[a-z-]+>|\.\.\.|xxx|redact|never|do not|environment variable/i.test(
    line,
  );
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (!SKIP_EXT.has(extname(entry)) && stat.size < 4_000_000) out.push(full);
  }
  return out;
}

function scan(files, label) {
  const findings = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (const [index, line] of lines.entries()) {
      if (isDocumentation(line)) continue;
      // The marker may sit on the line itself or on the line above it, so a
      // long fixture string does not have to carry a trailing comment.
      if (line.includes(ALLOW_MARKER) || (lines[index - 1] ?? '').includes(ALLOW_MARKER)) {
        continue;
      }
      for (const pattern of PATTERNS) {
        if (pattern.re.test(line)) {
          findings.push(`${label}: ${relative(ROOT, file)}:${index + 1} — ${pattern.name}`);
        }
      }
    }
  }
  return findings;
}

const sourceFindings = scan(walk(ROOT), 'source');

let bundleFindings = [];
if (existsSync(join(ROOT, 'dist'))) {
  bundleFindings = scan(walk(join(ROOT, 'dist')), 'BUNDLE');
} else {
  console.log('note: dist/ absent — run `npm run build` first to scan the shipped bundle');
}

const findings = [...sourceFindings, ...bundleFindings];
if (findings.length > 0) {
  console.error(`Secret scan FAILED with ${findings.length} finding(s):`);
  for (const finding of findings) console.error(`  ${finding}`);
  process.exit(1);
}

console.log(
  `Secret scan clean: ${walk(ROOT).length} source files` +
    (existsSync(join(ROOT, 'dist')) ? ' and the built bundle' : ''),
);
