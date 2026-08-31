/**
 * Four-point projective mapping, used to lay a real DOM panel exactly over a
 * monitor's screen quad in the WebGL scene.
 *
 * docs/PROJECT_CONTEXT.md §7 requires the interactive monitor to be native DOM
 * aligned over the canvas — never text baked into a texture — and explicitly
 * rules out CSS3DRenderer. This is the small piece of maths that makes the
 * cheaper approach work: project the four screen corners with the camera we
 * already have, then solve for the CSS `matrix3d` that maps a plain rectangle
 * onto that quad.
 */

export type Point = { x: number; y: number };
export type Quad = [Point, Point, Point, Point];

/**
 * Solves `A x = b` by Gaussian elimination with partial pivoting.
 * Returns null for a singular system, which happens when the quad is degenerate
 * (a monitor edge-on to the camera, or off screen).
 */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]!]);

  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row]![column]!) > Math.abs(a[pivot]![column]!)) pivot = row;
    }
    if (Math.abs(a[pivot]![column]!) < 1e-9) return null;

    [a[column], a[pivot]] = [a[pivot]!, a[column]!];

    const pivotRow = a[column]!;
    const pivotValue = pivotRow[column]!;
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const target = a[row]!;
      const factor = target[column]! / pivotValue;
      if (factor === 0) continue;
      for (let k = column; k <= n; k += 1) {
        target[k] = target[k]! - factor * pivotRow[k]!;
      }
    }
  }

  return a.map((row, index) => row[n]! / row[index]!);
}

/**
 * Builds the CSS `matrix3d` that maps the rectangle `(0,0)-(width,height)` onto
 * `quad`, in the order top-left, top-right, bottom-right, bottom-left.
 *
 * Apply it with `transform-origin: 0 0`.
 */
export function quadToMatrix3d(width: number, height: number, quad: Quad): string | null {
  if (width <= 0 || height <= 0) return null;

  const source: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];

  // Standard 8-unknown formulation of a 2D homography.
  const rows: number[][] = [];
  const values: number[] = [];

  for (let i = 0; i < 4; i += 1) {
    const s = source[i]!;
    const d = quad[i]!;
    rows.push([s.x, s.y, 1, 0, 0, 0, -s.x * d.x, -s.y * d.x]);
    values.push(d.x);
    rows.push([0, 0, 0, s.x, s.y, 1, -s.x * d.y, -s.y * d.y]);
    values.push(d.y);
  }

  const h = solve(rows, values);
  if (!h) return null;
  if (h.some((value) => !Number.isFinite(value))) return null;

  const [a, b, c, d, e, f, g, i] = h as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // Column-major 4x4, with the projective terms in the w row.
  const matrix = [a, d, 0, g, b, e, 0, i, 0, 0, 1, 0, c, f, 0, 1];

  // Significant digits, not decimal places: the perspective terms are around
  // 1e-4, so fixed 6dp would quantise them to ~1% error and push the mapped
  // corners visibly off the bezel.
  return `matrix3d(${matrix.map(format).join(',')})`;
}

function format(value: number): string {
  if (value === 0) return '0';
  return Number(value.toPrecision(12)).toString();
}

/** True when the quad is large enough and convex enough to be worth rendering. */
export function isQuadUsable(quad: Quad, minArea = 400): boolean {
  let area = 0;
  for (let i = 0; i < 4; i += 1) {
    const current = quad[i]!;
    const next = quad[(i + 1) % 4]!;
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area / 2) >= minArea;
}
