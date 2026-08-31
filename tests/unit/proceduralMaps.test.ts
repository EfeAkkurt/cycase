import type * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import {
  grainNormalMap,
  roughnessVariation,
  variedRoughness,
} from '../../src/three/proceduralMaps';

/**
 * The generated roughness and normal maps.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §8 asks for texture-driven
 * roughness and normal variation where a constant is doing a map's job. Two
 * things about that can go quietly wrong, and both are checked here rather than
 * left to a screenshot:
 *
 *  1. **The multiplier.** `MeshStandardMaterial` evaluates
 *     `roughness * roughnessMap.g`. A map with a mean below 1 hung beside an
 *     unchanged constant ships a *smoother* surface than the one it replaced,
 *     with new specular highlights — and `tests/e2e/headlook.spec.ts` requires
 *     the centre alarm to out-read every other bright thing in the frame. The
 *     generator therefore reports its own exact mean and `variedRoughness`
 *     divides by it, so the mean effective roughness of every surface is
 *     unchanged and only the variation is new.
 *  2. **The seam.** These tile — 24 times across a 1.56 m desk mat, 40 across a
 *     keyboard plate — so noise that is not periodic draws a visible grid in
 *     the nearest band of the picture.
 *
 * Determinism matters for a third reason: the room is rendered by a demand
 * loop and screenshotted by pixel gates, and a texture that differed run to run
 * would make every one of those gates flaky in a way that looks like a
 * regression somewhere else.
 */

const ROUGH = { seed: 17, size: 64, cells: 9, amplitude: 0.16, repeat: 30 } as const;

function bytes(texture: THREE.DataTexture): Uint8Array {
  return texture.image.data as Uint8Array;
}

describe('roughnessVariation', () => {
  it('is deterministic for a seed, and different for another', () => {
    const first = roughnessVariation(ROUGH);
    const again = roughnessVariation(ROUGH);
    expect(Array.from(bytes(first.texture))).toEqual(Array.from(bytes(again.texture)));
    expect(first.mean).toBe(again.mean);

    const other = roughnessVariation({ ...ROUGH, seed: ROUGH.seed + 1 });
    expect(Array.from(bytes(other.texture))).not.toEqual(Array.from(bytes(first.texture)));
  });

  it('is grey, so it can introduce no hue at all', () => {
    const data = bytes(roughnessVariation(ROUGH).texture);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBe(data[i + 1]);
      expect(data[i]).toBe(data[i + 2]);
      expect(data[i + 3]).toBe(255);
    }
  });

  it('only ever roughens, inside the amplitude it was asked for', () => {
    const data = bytes(roughnessVariation(ROUGH).texture);
    const floor = Math.floor((1 - ROUGH.amplitude) * 255) - 1;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]!).toBeLessThanOrEqual(255);
      expect(data[i]!).toBeGreaterThanOrEqual(floor);
    }
  });

  it('reports the mean it actually has', () => {
    const { texture, mean } = roughnessVariation(ROUGH);
    const data = bytes(texture);
    let total = 0;
    let count = 0;
    for (let i = 1; i < data.length; i += 4) {
      total += data[i]! / 255;
      count += 1;
    }
    expect(mean).toBeCloseTo(total / count, 12);
    // A map whose mean is 1 would be doing nothing; one near 0 would black the
    // surface out. This is variation, and it sits where variation sits.
    expect(mean).toBeGreaterThan(0.8);
    expect(mean).toBeLessThan(1);
  });

  it('tiles without a seam', () => {
    const size = ROUGH.size;
    const data = bytes(roughnessVariation(ROUGH).texture);
    const at = (x: number, y: number) => data[(y * size + x) * 4]!;

    let acrossWrap = 0;
    let interior = 0;
    for (let y = 0; y < size; y += 1) {
      acrossWrap += Math.abs(at(size - 1, y) - at(0, y));
      interior += Math.abs(at(size >> 1, y) - at((size >> 1) - 1, y));
    }

    // The wrap-around edge is just another pair of neighbouring columns. If the
    // noise were not periodic this would be a step of tens of levels against a
    // handful.
    expect(acrossWrap, `wrap edge ${acrossWrap} vs interior ${interior}`).toBeLessThanOrEqual(
      Math.max(interior * 3, size * 2),
    );
  });
});

describe('variedRoughness', () => {
  it('keeps the shipped mean roughness exactly where it was', () => {
    const { mean } = roughnessVariation(ROUGH);
    for (const base of [0.55, 0.66, 0.72, 0.78]) {
      expect(variedRoughness(base, mean) * mean).toBeCloseTo(base, 12);
    }
  });

  it('clamps at the ceiling rather than shipping an invalid roughness', () => {
    // 0.99 with a mean of 0.95 wants 1.042; `MeshStandardMaterial` tops out at
    // 1, so the desk mat is the one surface whose mean legitimately moves.
    expect(variedRoughness(0.99, 0.95)).toBe(1);
    expect(variedRoughness(0.5, 0)).toBe(0.5);
  });
});

describe('grainNormalMap', () => {
  it('is deterministic and stays a subtle perturbation', () => {
    const options = { seed: 7, size: 64, cells: 12, amplitude: 1, strength: 0.0022, repeat: 24 };
    const first = bytes(grainNormalMap(options));
    expect(Array.from(bytes(grainNormalMap(options)))).toEqual(Array.from(first));

    /*
     * Every normal still points essentially out of the surface. A normal map
     * whose blue channel wanders far from 255 is relief, not grain, and relief
     * on a desk mat reads as a pattern printed on it.
     */
    let lowest = 255;
    for (let i = 2; i < first.length; i += 4) lowest = Math.min(lowest, first[i]!);
    expect(lowest, `steepest normal encodes z = ${lowest}`).toBeGreaterThan(230);

    // And the x/y deflection is centred: no net tilt across the surface.
    let x = 0;
    let y = 0;
    let count = 0;
    for (let i = 0; i < first.length; i += 4) {
      x += first[i]! - 127.5;
      y += first[i + 1]! - 127.5;
      count += 1;
    }
    expect(Math.abs(x / count)).toBeLessThan(2);
    expect(Math.abs(y / count)).toBeLessThan(2);
  });

  it('costs nothing on the wire and a known amount in memory', () => {
    // Generated, not fetched: nothing here appears in the asset manifest or in
    // the 12 MB first-load budget. 256 x 256 RGBA is 262,144 bytes resident.
    expect(bytes(grainNormalMap({ seed: 7, size: 256, cells: 12, amplitude: 1 })).length).toBe(
      256 * 256 * 4,
    );
  });
});
