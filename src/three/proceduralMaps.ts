/**
 * Roughness and normal variation, generated rather than downloaded.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §8: "use texture-driven roughness/
 * normal variation" where a constant is doing the job of a map. Four surfaces
 * in this room were a single number each — a felt desk mat at `roughness: 0.99`,
 * a moulded keyboard plate at 0.78, three monitor shells at 0.66 and the stand
 * metal at 0.55 — and a surface with one roughness everywhere has one specular
 * response everywhere. That is the flat, wax-model look, and it survives any
 * amount of geometry work because it is a material fact rather than a shape one.
 *
 * Generated, for the same reason `WarmEnvironment` generates its environment:
 * the licence and byte budgets are real. A Poly Haven fabric set is three
 * images and about a megabyte against a 12 MB first-load budget, and the room
 * already spends most of it. These cost nothing on the wire — they are built in
 * memory at scene construction — and nothing in `ASSET_LICENSES.md`, because
 * there is no asset.
 *
 * ## The multiplier, which is the part that bites
 *
 * `MeshStandardMaterial` **multiplies** the scalar `roughness` by the green
 * channel of `roughnessMap`. Hanging a map with a mean of 0.9 on a material at
 * `roughness: 0.66` therefore ships a surface at 0.59 — smoother than before,
 * with new specular highlights, straight into the gate in
 * `tests/e2e/headlook.spec.ts` that requires the centre alarm to out-read
 * everything else in the frame.
 *
 * So `roughnessVariation` returns its own exact mean, and `variedRoughness`
 * divides the shipped constant by it. The mean effective roughness of every
 * surface below is therefore *unchanged*, to floating point; what is new is the
 * variation around it. That is what the redesign asked for, and it is the only
 * form of it that cannot spend a gate.
 *
 * ## Colour
 *
 * The roughness maps are grey — R, G and B carry the same byte — so they can
 * introduce no hue at all. Normal maps are blue by construction, and that is
 * not a palette concern: `tests/e2e/palette.spec.ts` classifies rendered
 * screenshot pixels, and a normal map is never rendered. What reaches the frame
 * is a perturbed lighting response under a warm two-stop environment.
 */
import * as THREE from 'three';

export interface NoiseOptions {
  /** Texture edge in pixels. Powers of two only — these are mipmapped. */
  size?: number;
  /** Lattice cells across the texture at the coarsest octave. */
  cells?: number;
  /** Deterministic seed. Two surfaces with the same seed share a pattern. */
  seed: number;
  /** How far the value swings below full scale, 0..1. */
  amplitude: number;
  /** Texture repeat, in tiles across the surface's UV space. */
  repeat?: number;
}

/**
 * A 32-bit integer hash. Deterministic across platforms because every step is
 * `Math.imul` or a shift — no floating point, so no rounding to disagree about.
 */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Tiling value noise at `(x, y)` in texture space.
 *
 * The lattice indices wrap at `cells`, so the field is periodic and the texture
 * has no seam when it repeats — which matters here more than it usually does,
 * because a 1.56 m desk mat tiles its map several times across the widest shape
 * in the foreground.
 */
function valueNoise(x: number, y: number, cells: number, seed: number): number {
  const fx = x * cells;
  const fy = y * cells;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = smooth(fx - x0);
  const ty = smooth(fy - y0);

  const wrap = (value: number) => ((value % cells) + cells) % cells;
  const xa = wrap(x0);
  const xb = wrap(x0 + 1);
  const ya = wrap(y0);
  const yb = wrap(y0 + 1);

  const top = hash(xa, ya, seed) * (1 - tx) + hash(xb, ya, seed) * tx;
  const bottom = hash(xa, yb, seed) * (1 - tx) + hash(xb, yb, seed) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Three octaves of the above, in 0..1. */
function fractalNoise(x: number, y: number, cells: number, seed: number): number {
  return (
    valueNoise(x, y, cells, seed) * 0.55 +
    valueNoise(x, y, cells * 2, seed + 101) * 0.3 +
    valueNoise(x, y, cells * 4, seed + 211) * 0.15
  );
}

function configure(texture: THREE.DataTexture, repeat: number): THREE.DataTexture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/**
 * A grey roughness map, and the exact mean of its green channel.
 *
 * Values run from `1 - amplitude` to 1, so the map can only ever roughen. The
 * mean is returned rather than assumed because `variedRoughness` divides by it,
 * and a mean that was estimated instead of counted would move every surface in
 * the room by a percent or two of specular.
 */
export function roughnessVariation(options: NoiseOptions): {
  texture: THREE.DataTexture;
  mean: number;
} {
  const size = options.size ?? 128;
  const cells = options.cells ?? 8;
  const data = new Uint8Array(size * size * 4);

  let total = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const noise = fractalNoise(x / size, y / size, cells, options.seed);
      const value = 1 - options.amplitude * noise;
      const byte = Math.max(0, Math.min(255, Math.round(value * 255)));
      total += byte / 255;
      const index = (y * size + x) * 4;
      data[index] = byte;
      data[index + 1] = byte;
      data[index + 2] = byte;
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return { texture: configure(texture, options.repeat ?? 1), mean: total / (size * size) };
}

/**
 * A tangent-space normal map from the same noise, by central differences.
 *
 * `strength` is the height of the field in the same units as one texel step, so
 * it reads as "how deep is the weave" rather than as an opaque multiplier. It
 * is kept low everywhere it is used: this is surface break-up, not relief, and
 * a normal map strong enough to notice as a pattern is a worse artefact than
 * the flat surface it replaced.
 */
export function grainNormalMap(options: NoiseOptions & { strength?: number }): THREE.DataTexture {
  const size = options.size ?? 128;
  const cells = options.cells ?? 8;
  const strength = options.strength ?? 1;
  const data = new Uint8Array(size * size * 4);

  const height = (x: number, y: number) =>
    fractalNoise(((x % size) + size) % size / size, ((y % size) + size) % size / size, cells, options.seed);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (height(x + 1, y) - height(x - 1, y)) * strength * size * 0.5;
      const dy = (height(x, y + 1) - height(x, y - 1)) * strength * size * 0.5;

      // Tangent-space normal of the height field, encoded 0..255 per channel.
      const length = Math.sqrt(dx * dx + dy * dy + 1);
      const index = (y * size + x) * 4;
      data[index] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      data[index + 1] = Math.round(((-dy / length) * 0.5 + 0.5) * 255);
      data[index + 2] = Math.round((1 / length) * 0.5 * 255 + 127.5);
      data[index + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return configure(texture, options.repeat ?? 1);
}

/**
 * The scalar to ship alongside a roughness map so the mean does not move.
 *
 * `roughness * map.g` is what the shader evaluates, so this is `base / mean`,
 * clamped at 1 — the ceiling `MeshStandardMaterial` itself uses.
 */
export function variedRoughness(base: number, mean: number): number {
  if (mean <= 0) return base;
  return Math.min(1, base / mean);
}
