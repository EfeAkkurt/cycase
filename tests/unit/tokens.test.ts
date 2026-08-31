import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Design-token conformance.
 *
 * "Looks about right" is not a contract, so the contract is here: every token
 * below is pinned, and the test fails if the stylesheet drifts from it.
 *
 * This replaces the warm-palette pixel gate that `docs/VISUAL_RESET.md`
 * originally specified — see that document's amendment for why it was retired
 * rather than quietly deleted.
 */

const TOKENS_FILE = path.resolve(import.meta.dirname, '../../src/styles/tokens.css');

function parseTokens(css: string): Map<string, string> {
  // Drop `@media` blocks: the reduced-motion override redefines the duration
  // tokens to 1ms, and a naive last-wins parse would read that as the value.
  const withoutMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');

  const tokens = new Map<string, string>();
  for (const match of withoutMedia.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens.set(match[1]!.trim(), match[2]!.trim().replace(/\s+/g, ' '));
  }
  return tokens;
}

const ours = parseTokens(readFileSync(TOKENS_FILE, 'utf8'));

/**
 * The values the stylesheet resolves to in dark mode. Surfaces, text and
 * brand come from its `.dark` block; scale, radius and density are
 * theme-independent and come from `:root`.
 */
const PINNED: Record<string, string> = {
  // Colour lives in the carbon block — see `CARBON_COLOUR` below.
  // Radius — hard lock
  '--radius-sm': '6px',
  '--radius-md': '8px',
  '--radius-lg': '12px',
  '--radius-full': '9999px',
  '--tray-frame-inset': '4px',
  '--radius-tray-inner': 'var(--radius-md)',
  '--radius-content-frame': '16px',

  // Type scale
  '--type-xs-size': '12px',
  '--type-xs-lh': '16px',
  '--type-sm-size': '13px',
  '--type-sm-lh': '18px',
  '--type-md-size': '14px',
  '--type-md-lh': '20px',
  '--type-lg-size': '16px',
  '--type-lg-lh': '22px',
  '--type-xl-size': '18px',
  '--type-xl-lh': '24px',
  '--type-2xl-size': '20px',
  '--type-2xl-lh': '26px',
  '--type-kpi-size': '24px',
  '--type-kpi-lh': '28px',

  // Weight lock and tracking
  '--fw-regular': '400',
  '--fw-medium': '500',
  '--tracking-normal': '-0.31px',

  // Density
  '--control-height-sm': '32px',
  '--control-height-md': '36px',
  '--control-height-lg': '44px',
  '--row-height-comfortable': '44px',
  '--row-height-compact': '32px',
  '--content-padding-x': 'var(--space-8)',
  '--content-padding-y': 'var(--space-6)',

  // Spacing — 4pt grid
  '--space-1': '4px',
  '--space-2': '8px',
  '--space-3': '12px',
  '--space-4': '16px',
  '--space-6': '24px',
  '--space-8': '32px',

  // Badge / chip
  '--badge-h-sm': '18px',
  '--badge-h-md': '20px',
  '--badge-h-lg': '24px',
  '--badge-px-md': '6px',
  '--badge-radius': 'var(--radius-full)',

  // Buttons
  '--btn-h-cta': 'var(--control-height-sm)',
  '--btn-radius': 'var(--radius-md)',
  '--dd-px': '12px',
  '--dd-gap': '8px',

  // Icons
  '--icon-size': '16px',
  '--icon-size-sm': '14px',
  '--icon-stroke': '1.2',

  // Motion
  '--motion-duration-instant': '80ms',
  '--motion-duration-fast': '150ms',
  '--motion-duration-base': '220ms',
  '--motion-duration-slow': '320ms',
  '--motion-easing-standard': 'cubic-bezier(0.2, 0, 0, 1)',
  '--motion-easing-emphasized': 'cubic-bezier(0.16, 1, 0.3, 1)',

  // Charts
};

/**
 * The carbon colour layer.
 * The physical anchors are pinned verbatim; the derived values are pinned to
 * what this project resolved them to, with the measured contrast beside each.
 */
const CARBON_COLOUR: Record<string, string> = {
  '--carbon': '#0b0b0a',
  '--carbon-raised': '#171716',
  '--carbon-sunken': '#141413',
  '--carbon-panel': '#16161a',
  '--bone': '#f2f0ed',
  '--gray-medium': '#2a2926',
  '--gray-dark': '#8f8b87',
  '--plate': '#201f1c',
  '--plate-soft': '#1a1a18',

  '--color-ink-rgb': '242, 240, 237',
  '--color-paper-rgb': '11, 11, 10',
  '--edge-control': 'rgba(255, 255, 255, 0.14)',
};

/**
 * The accent and status layer follows the audit contract (P0.4): warm-neutral
 * direction, no decorative blue, red reserved for threats. The product owner
 * accepted that contract, which superseded an earlier blue accent that arrived
 * with the port. Every foreground below was measured against its own 12% chip
 * on the raised surface: accent 6.2:1, success 6.0:1, warning 5.4:1, error
 * 4.9:1.
 */
const AUDIT_ACCENT: Record<string, string> = {
  '--brand-primary': '#c8a26a',
  '--brand-primary-hover': '#d4b078',
  '--brand-primary-fg': '#0b0b0a',
  '--brand-on-dark': '#c8a26a',
  '--status-success-fill': '#7e9464',
  '--status-warning-fill': '#f07a34',
  '--status-error-fill': '#e2604e',
  '--status-success': '#8fae75',
  '--status-warning': '#f07a34',
  '--status-error': '#e8695c',
};

describe('design token conformance', () => {
  it('defines every pinned token', () => {
    const missing = [...Object.keys(PINNED), ...Object.keys(CARBON_COLOUR), ...Object.keys(AUDIT_ACCENT)].filter(
      (name) => !ours.has(name),
    );
    expect(missing, `missing tokens: ${missing.join(', ')}`).toEqual([]);
  });

  it('matches the pinned value for value', () => {
    const drifted: string[] = [];
    for (const [name, expected] of Object.entries({ ...PINNED, ...CARBON_COLOUR, ...AUDIT_ACCENT })) {
      const actual = ours.get(name);
      if (actual !== expected) drifted.push(`${name}: ${actual} !== ${expected}`);
    }
    expect(drifted, drifted.join('\n')).toEqual([]);
  });

  it('locks font weights to 400 and 500 — this system has no bold', () => {
    const weights = [...ours.entries()].filter(([name]) => name.startsWith('--fw-'));
    expect(weights.map(([, value]) => value).sort()).toEqual(['400', '500']);
  });

  it('locks the radius scale to 6 / 8 / 12 plus the pill', () => {
    expect([
      ours.get('--radius-sm'),
      ours.get('--radius-md'),
      ours.get('--radius-lg'),
      ours.get('--radius-full'),
    ]).toEqual(['6px', '8px', '12px', '9999px']);
  });

  it('contains no blue, cyan or teal anywhere in the token file (audit P0.4)', () => {
    const cool: string[] = [];
    for (const [name, value] of ours) {
      for (const match of value.matchAll(/#([0-9a-f]{6})\b/gi)) {
        const hex = match[1]!;
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        if (b - r > 18 || Math.min(g, b) - r > 18) cool.push(`${name}: #${hex}`);
      }
    }
    expect(cool, cool.join('\n')).toEqual([]);
  });

  it('keeps the concentric tray relationship: outer = inner + frame inset', () => {
    expect(ours.get('--radius-tray-outer')).toBe(
      'calc(var(--radius-tray-inner) + var(--tray-frame-inset))',
    );
  });

  /*
   * The followed-row wash, pinned by measurement rather than by eye.
   *
   * A review read this rule as a contrast failure. Measured, the text on the
   * row is fine and always was; what was actually wrong is that the wash sat
   * 1.22:1 from an unfollowed row, which is a tint nobody can see. Raising it
   * trades against the text contrast on the same row, so both ends are pinned
   * here and neither can be moved without the other being re-checked.
   *
   * The 3:1 non-text-contrast requirement is deliberately NOT asserted against
   * this wash: the state is carried by the left rule on the row header and by
   * the "Followed" badge, so it survives a monochrome display. That rule's
   * contrast is asserted below, because it is the part that has to hold.
   */
  describe('the followed row', () => {
    const CELL = '#171716'; // --tray-cell-bg

    function channels(hex: string): [number, number, number] {
      return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    }

    function alpha(token: string): { rgb: [number, number, number]; a: number } {
      const value = ours.get(token)!;
      const match = value.match(/rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/)!;
      return {
        rgb: [Number(match[1]), Number(match[2]), Number(match[3])],
        a: Number(match[4]),
      };
    }

    function over(
      fg: [number, number, number],
      a: number,
      bg: [number, number, number],
    ): [number, number, number] {
      return fg.map((f, i) => a * f + (1 - a) * bg[i]!) as [number, number, number];
    }

    function luminance([r, g, b]: [number, number, number]): number {
      const lin = (c: number) => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    }

    function ratio(a: [number, number, number], b: [number, number, number]): number {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    }

    const cell = channels(CELL);
    const wash = alpha('--row-followed-bg');
    const row = over(wash.rgb, wash.a, cell);
    const ink = channels(ours.get('--bone')!);

    it('is visible as a tint against an unfollowed row', () => {
      expect(ratio(row, cell)).toBeGreaterThan(1.4);
    });

    it('still carries primary text at 4.5:1', () => {
      expect(ratio(ink, row)).toBeGreaterThan(4.5);
    });

    it('still carries secondary text at 4.5:1', () => {
      // --text-secondary is the ink at 62% over whatever it sits on.
      expect(ratio(over(ink, 0.62, row), row)).toBeGreaterThan(4.5);
    });

    it('identifies the state with a rule that clears 3:1 on its own', () => {
      // .row--focused > th:first-child { box-shadow: inset 3px 0 0 --brand-primary }
      expect(ratio(channels(ours.get('--brand-primary')!), cell)).toBeGreaterThan(3);
    });
  });
});

