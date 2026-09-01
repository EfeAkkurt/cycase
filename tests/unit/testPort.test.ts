import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEST_PORT,
  TEST_PORT_ENV,
  resolveTestPort,
  testBaseUrl,
  testDistDir,
} from '../../scripts/test-port.mjs';

/**
 * The contract every browser suite binds and addresses through.
 *
 * Four places used to name 4183 themselves: the Playwright `baseURL`, the
 * `webServer` URL, the static server, and the guard that clears the port before
 * a run. Two suites at once meant one run's guard killing the other run's
 * server, or a run silently attaching to a server built from someone else's
 * tree — both of which surface as a wall of failing tests rather than as a
 * collision, which is what makes them expensive.
 *
 * What is pinned here is the part a person can get wrong from a shell. The
 * default has to be exactly what it was, or every serial run and every release
 * gate changes behaviour for no reason. And a value that is present but not a
 * port has to fail loudly: a typo that quietly resolved to 4183 would put two
 * parallel runs back on one port, which is the failure this module exists to
 * remove, reintroduced at the moment it is hardest to see.
 */
describe('the test port', () => {
  describe('with no preference expressed', () => {
    it('is 4183, the port every existing suite and gate already uses', () => {
      expect(DEFAULT_TEST_PORT).toBe(4183);
      expect(resolveTestPort({})).toBe(4183);
    });

    it('is 4183 when the variable is set to nothing at all', () => {
      // An empty assignment carries no intent — `CYCASE_TEST_PORT= npm test`
      // is a person clearing the variable, not choosing port zero.
      expect(resolveTestPort({ [TEST_PORT_ENV]: '' })).toBe(DEFAULT_TEST_PORT);
      expect(resolveTestPort({ [TEST_PORT_ENV]: '   ' })).toBe(DEFAULT_TEST_PORT);
      expect(resolveTestPort({ [TEST_PORT_ENV]: '\t\n' })).toBe(DEFAULT_TEST_PORT);
    });

    it('is 4183 when the variable is explicitly undefined', () => {
      expect(resolveTestPort({ [TEST_PORT_ENV]: undefined })).toBe(DEFAULT_TEST_PORT);
    });
  });

  describe('with a port named', () => {
    it('uses it', () => {
      expect(resolveTestPort({ [TEST_PORT_ENV]: '4283' })).toBe(4283);
      expect(resolveTestPort({ [TEST_PORT_ENV]: '4383' })).toBe(4383);
    });

    it('tolerates the whitespace a shell or a CI variable can leave behind', () => {
      expect(resolveTestPort({ [TEST_PORT_ENV]: '  4283  ' })).toBe(4283);
    });

    it('accepts both ends of the TCP range', () => {
      expect(resolveTestPort({ [TEST_PORT_ENV]: '1' })).toBe(1);
      expect(resolveTestPort({ [TEST_PORT_ENV]: '65535' })).toBe(65535);
    });
  });

  describe('with something that is not a port', () => {
    /*
     * Each of these would have become 4183 under a `Number(x) || 4183` style
     * fallback, and two parallel runs would then have collided on it. The throw
     * is the whole point: the operator finds out at the shell, not four minutes
     * into a run whose failures look like product regressions.
     */
    const rejected = [
      ['a typo', '428x'],
      ['a word', 'abc'],
      ['hex, which Number would have accepted', '0x10bb'],
      ['a decimal, which Number would have accepted', '4283.0'],
      ['a fraction', '42.5'],
      ['a negative', '-1'],
      ['port zero', '0'],
      ['one past the top of the range', '65536'],
      ['a range that does not fit in sixteen bits', '99999'],
      ['a port with a unit', '4283ms'],
      ['a URL rather than a port', 'http://127.0.0.1:4283'],
    ] as const;

    for (const [why, value] of rejected) {
      it(`refuses ${why}: ${JSON.stringify(value)}`, () => {
        expect(() => resolveTestPort({ [TEST_PORT_ENV]: value })).toThrow();
      });
    }

    it('names the variable and the accepted range, so the message is actionable', () => {
      expect(() => resolveTestPort({ [TEST_PORT_ENV]: '428x' })).toThrow(
        /CYCASE_TEST_PORT.*1 and 65535/s,
      );
    });

    it('never silently resolves a bad value to the default', () => {
      // The regression this file exists for. If this ever returns a number,
      // two parallel runs can land on one port again.
      for (const [, value] of rejected) {
        let resolved: number | null = null;
        try {
          resolved = resolveTestPort({ [TEST_PORT_ENV]: value });
        } catch {
          // Expected.
        }
        expect(resolved, `${value} resolved to ${resolved} instead of throwing`).toBeNull();
      }
    });
  });

  describe('the URL every caller addresses the server by', () => {
    it('is the loopback address on the resolved port', () => {
      expect(testBaseUrl({})).toBe('http://127.0.0.1:4183');
      expect(testBaseUrl({ [TEST_PORT_ENV]: '4283' })).toBe('http://127.0.0.1:4283');
    });

    it('is a URL the browser and the server can both parse', () => {
      expect(new URL(testBaseUrl({ [TEST_PORT_ENV]: '4383' })).port).toBe('4383');
    });
  });

  describe('the build output directory', () => {
    /*
     * A port each was not enough. Both runs still built into `dist/`, vite
     * empties its output directory before writing, and the second build wiped
     * the first mid-copy: `ENOENT: copyfile public/models/... -> dist/models/...`.
     * Deterministic on every overlapping pair, so the directory follows the port.
     */
    it('is dist on the default port, so nothing about a serial run moves', () => {
      expect(testDistDir({})).toBe('dist');
      expect(testDistDir({ [TEST_PORT_ENV]: '' })).toBe('dist');
      expect(testDistDir({ [TEST_PORT_ENV]: String(DEFAULT_TEST_PORT) })).toBe('dist');
    });

    it('is its own directory on any other port', () => {
      expect(testDistDir({ [TEST_PORT_ENV]: '4283' })).toBe('dist-4283');
      expect(testDistDir({ [TEST_PORT_ENV]: '4383' })).toBe('dist-4383');
    });

    it('gives two different ports two different directories', () => {
      // The property that actually matters: no overlapping pair can share one
      // output tree, whatever the ports are.
      expect(testDistDir({ [TEST_PORT_ENV]: '4283' })).not.toBe(
        testDistDir({ [TEST_PORT_ENV]: '4383' }),
      );
    });

    it('refuses a bad port here too, rather than inventing a directory for it', () => {
      expect(() => testDistDir({ [TEST_PORT_ENV]: '428x' })).toThrow();
    });
  });

  describe('reading the real environment', () => {
    it('defaults when the variable is absent from it', () => {
      // Called with no argument, the way playwright.config.ts calls it. The
      // gates run with CYCASE_TEST_PORT unset, so this must be the default —
      // if it is not, every release gate has quietly changed port.
      const before = process.env[TEST_PORT_ENV];
      delete process.env[TEST_PORT_ENV];
      try {
        expect(resolveTestPort()).toBe(DEFAULT_TEST_PORT);
      } finally {
        if (before !== undefined) process.env[TEST_PORT_ENV] = before;
      }
    });
  });
});
