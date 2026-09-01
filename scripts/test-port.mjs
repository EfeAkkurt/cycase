#!/usr/bin/env node
/**
 * One port, agreed on by everything that has to bind or address it.
 *
 * The browser suites used to hard-code 4183 in four places: the Playwright
 * `baseURL`, the `webServer` URL it waits on, the static server that binds it,
 * and the guard that clears it first. That is fine for one suite at a time and
 * fatal for two — a second run finds the first run's server already answering,
 * or `free-test-port.mjs` kills a server the other run is still using, and both
 * fail in ways that read as product regressions rather than as a collision.
 *
 * So the port comes from here. `CYCASE_TEST_PORT` selects it; with the variable
 * unset every caller resolves to 4183 and nothing about a single serial run
 * changes.
 *
 * On a bad value this THROWS rather than falling back, and that is deliberate.
 * A typo in `CYCASE_TEST_PORT=428x` that quietly became 4183 would put two
 * parallel runs back on one port — the exact failure this module exists to
 * remove, reintroduced silently and at the worst possible moment. An empty or
 * whitespace-only value is different: it carries no intent, so it is read as
 * "unset" and resolves to the default.
 */

/** The port every browser suite has used, and still uses when nothing says otherwise. */
export const DEFAULT_TEST_PORT = 4183;

/** The variable that selects a port for one run. */
export const TEST_PORT_ENV = 'CYCASE_TEST_PORT';

/**
 * Resolve the port for this run.
 *
 * `env` is injectable so the unit test can pin the behaviour without mutating
 * `process.env` and leaking that mutation into whatever runs next.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolveTestPort(env = process.env) {
  const raw = env[TEST_PORT_ENV];

  // Unset, or set to nothing in particular. Both mean "no preference".
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return DEFAULT_TEST_PORT;
  }

  const text = String(raw).trim();

  // `Number` accepts '4283.0', '0x10bb' and ' 4283 '; a port is a decimal
  // integer and nothing else, so the shape is checked before the value.
  if (!/^\d+$/.test(text)) {
    throw new Error(
      `${TEST_PORT_ENV}="${raw}" is not a port. Give a decimal integer between 1 and 65535, ` +
        `or leave it unset to use ${DEFAULT_TEST_PORT}.`,
    );
  }

  const port = Number(text);
  if (port < 1 || port > 65535) {
    throw new Error(
      `${TEST_PORT_ENV}="${raw}" is outside the TCP port range. Give a value between 1 and 65535, ` +
        `or leave it unset to use ${DEFAULT_TEST_PORT}.`,
    );
  }

  return port;
}

/** `http://127.0.0.1:<port>`, the one form every caller addresses the server by. */
export function testBaseUrl(env = process.env) {
  return `http://127.0.0.1:${resolveTestPort(env)}`;
}

/**
 * Where this run's build goes.
 *
 * A port each is not enough on its own. Both runs still built into `dist/`, and
 * vite empties its output directory before it writes: the second build wiped
 * the first mid-copy and it died on
 * `ENOENT: copyfile public/models/... -> dist/models/...`. That is not a flake,
 * it is two processes owning one directory, and it happens on every overlapping
 * pair.
 *
 * So the output directory follows the port. One variable isolates a whole run —
 * its server, its port, and the bytes that server is serving — and with
 * `CYCASE_TEST_PORT` unset this is `dist`, exactly as it has always been, so
 * every serial run and every release gate is untouched.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function testDistDir(env = process.env) {
  const port = resolveTestPort(env);
  return port === DEFAULT_TEST_PORT ? 'dist' : `dist-${port}`;
}
