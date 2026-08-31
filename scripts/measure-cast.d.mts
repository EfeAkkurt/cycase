/**
 * Types for the pieces `tests/unit/measureCast.test.ts` imports.
 *
 * The script itself is plain ESM JavaScript and stays that way — it is a review
 * instrument, not shipped code. Only what a test needs is declared, so the
 * declaration cannot drift into claiming things about the rest of the file.
 * Same arrangement, and the same reason, as `scripts/fetch-assets.d.mts`.
 */

/** The approved neutral frame every capture is compared against. */
export declare const REFERENCE: string;

/** The frames measured when the command line names none. */
export declare const DEFAULT_TARGETS: string[];

/** Which of these paths are not on disk, in the order given. */
export declare function missingTargets(files: string[]): string[];

export interface CastMeasurement {
  file: string;
  r: number;
  g: number;
  b: number;
  /** Mean red minus mean blue: the number the word "orange" was standing in for. */
  warmth: number;
  /** Mean HSV saturation, 0..1. */
  saturation: number;
}

export declare function measure(file: string): CastMeasurement;

/** Prints the report and returns the process exit code. */
export declare function run(argv: string[]): number;
