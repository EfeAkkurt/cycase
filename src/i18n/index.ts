import { en, type StringKey } from './en';

export type { StringKey };

/**
 * Single-locale string table. Every user-visible string in the app — and every
 * string returned to a WebMCP agent — resolves through `t()`, so copy lives in
 * one auditable place instead of being scattered through JSX.
 */
export type InterpolationValues = Record<string, string | number>;

const PLACEHOLDER = /\{(\w+)\}/g;

export function t(key: StringKey, values?: InterpolationValues): string {
  const template = en[key];
  if (!values) return template;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    const value = values[name];
    return value === undefined ? match : String(value);
  });
}

/**
 * Resolves a key that is only known at runtime (fixtures store keys as plain
 * strings). Returns the key itself if it is not in the table, which makes a
 * typo visible in the UI instead of rendering an empty node.
 */
export function tk(key: string, values?: InterpolationValues): string {
  if (key in en) return t(key as StringKey, values);
  return key;
}

export function hasKey(key: string): key is StringKey {
  return key in en;
}
