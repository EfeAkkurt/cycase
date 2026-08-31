import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * The single source for build/version metadata (delivery plan, Phase 0).
 *
 * Both `vite.config.ts` and `vitest.config.ts` import this, so a bundle and the test
 * run that guards it can never disagree about what the build identity is — which is
 * exactly the failure this file exists to prevent. `vite.config.ts` also writes the
 * same three values to `dist/build-info.json`, so the deployed origin can be
 * identified with `curl` rather than only from a browser console.
 */
export function buildDefines(): Record<string, string> {
  return definesFor(buildInfo());
}

/**
 * The `define` map for an identity that has already been resolved.
 *
 * `vite.config.ts` needs the same identity twice — substituted into the bundle and
 * written to `dist/build-info.json` — and calling `buildInfo()` twice would stamp two
 * `builtAt` timestamps a few milliseconds apart. A deployed page whose console and
 * whose JSON file disagree about when it was built is precisely the confusion this
 * module exists to prevent, so the identity is resolved once and shared.
 */
export function definesFor(info: BuildIdentity): Record<string, string> {
  return {
    __BUILD_SHA__: JSON.stringify(info.sha),
    __BUILD_TIME__: JSON.stringify(info.builtAt),
    __BUILD_VERSION__: JSON.stringify(info.version),
  };
}

export interface BuildIdentity {
  sha: string;
  builtAt: string;
  version: string;
}

/** The same three values `buildDefines()` substitutes, as data. */
export function buildInfo(): BuildIdentity {
  return {
    sha: resolveSha(),
    builtAt: new Date().toISOString(),
    version: packageVersion(),
  };
}

/**
 * Environment SHAs the supported hosts set for us, in precedence order.
 *
 * These are checked *before* git on purpose. A host checkout is shallow and often
 * detached, which can leave `git status --porcelain` non-empty for reasons that have
 * nothing to do with the source — and stamping a deployed build `-dev` because the
 * host left a lockfile artifact behind would make the build identity a lie exactly
 * where it matters most. When the host tells us the commit, believe the host.
 */
const HOST_SHA_VARS = [
  'BUILD_SHA', // explicit: `vercel deploy --build-env BUILD_SHA=...`, or any CI
  'VERCEL_GIT_COMMIT_SHA',
  'COMMIT_REF', // Netlify
];

/**
 * True when something other than a developer's shell is running the build.
 *
 * The host-SHA precedence below is right on a host and wrong on a laptop. A
 * stray `BUILD_SHA` in someone's shell would otherwise suppress the `-dev`
 * marker silently — the build would claim to be a clean commit while the tree
 * had uncommitted changes in it, which is the one thing this whole module
 * exists to prevent.
 */
function onBuildHost(): boolean {
  return ['CI', 'VERCEL', 'NETLIFY', 'GITHUB_ACTIONS', 'CF_PAGES'].some((name) =>
    Boolean(process.env[name]?.trim()),
  );
}

/** Short SHA, marked `-dev` when a local tree has uncommitted changes. */
function resolveSha(): string {
  if (onBuildHost()) {
    for (const name of HOST_SHA_VARS) {
      const value = process.env[name]?.trim();
      // Hosts supply the full 40-character SHA; `git rev-parse --short` gives 7. Match
      // the local form so a deployed identity can be compared with a local one by eye.
      if (value) return value.slice(0, 7);
    }
  }

  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim().length > 0;
    return dirty ? `${sha}-dev` : sha;
  } catch {
    // A source tarball has no .git and no host variable either.
    return 'unknown';
  }
}

function packageVersion(): string {
  const path = fileURLToPath(new URL('../package.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')).version as string;
}
