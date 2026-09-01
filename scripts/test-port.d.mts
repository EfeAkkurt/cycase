/**
 * Types for the shared test-port resolver.
 *
 * The script itself is plain ESM JavaScript, like the other entries in this
 * directory, and stays that way. Only what `playwright.config.ts` and
 * `tests/unit/testPort.test.ts` import is declared, so the declaration cannot
 * drift into claiming things about the rest of the file. Same arrangement, and
 * the same reason, as `scripts/measure-cast.d.mts`.
 */

/** The port every browser suite has used, and still uses when nothing says otherwise. */
export declare const DEFAULT_TEST_PORT: number;

/** The variable that selects a port for one run. */
export declare const TEST_PORT_ENV: string;

/**
 * The port for this run. Throws on a value that is present but not a port;
 * an unset, empty or whitespace-only value resolves to `DEFAULT_TEST_PORT`.
 */
export declare function resolveTestPort(env?: Record<string, string | undefined>): number;

/** `http://127.0.0.1:<port>` for the resolved port. */
export declare function testBaseUrl(env?: Record<string, string | undefined>): string;

/**
 * The build output directory for this run: `dist` on the default port, and
 * `dist-<port>` otherwise, so two overlapping runs never share one output tree.
 */
export declare function testDistDir(env?: Record<string, string | undefined>): string;
