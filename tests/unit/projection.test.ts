import { describe, expect, it } from 'vitest';

import { isQuadUsable, quadToMatrix3d, type Quad } from '../../src/three/homography';
import { computeMonitorPlacements, createCamera } from '../../src/three/projection';
import { MONITORS } from '../../src/three/layout';

/**
 * The DOM-over-WebGL alignment is the piece that makes the office monitors real
 * interface rather than baked texture, and it is pure maths — so it is tested
 * here rather than only eyeballed in a browser.
 */

/** Applies a CSS matrix3d string to a point, the way the compositor would. */
function applyMatrix3d(matrix: string, x: number, y: number): { x: number; y: number } {
  const values = matrix
    .slice('matrix3d('.length, -1)
    .split(',')
    .map(Number);

  // Column-major 4x4 against the column vector (x, y, 0, 1).
  const [m0, m1, , m3, m4, m5, , m7, , , , , m12, m13, , m15] = values as number[];
  const outX = m0! * x + m4! * y + m12!;
  const outY = m1! * x + m5! * y + m13!;
  const outW = m3! * x + m7! * y + m15!;

  return { x: outX / outW, y: outY / outW };
}

describe('quadToMatrix3d', () => {
  it('maps the source rectangle exactly onto the destination quad', () => {
    const quad: Quad = [
      { x: 120, y: 40 },
      { x: 460, y: 90 },
      { x: 440, y: 320 },
      { x: 100, y: 260 },
    ];
    const matrix = quadToMatrix3d(200, 100, quad);
    expect(matrix).not.toBeNull();

    const corners = [
      [0, 0],
      [200, 0],
      [200, 100],
      [0, 100],
    ] as const;

    corners.forEach(([x, y], index) => {
      const mapped = applyMatrix3d(matrix!, x, y);
      // Sub-pixel: the panel edge has to land on the bezel, not near it.
      expect(mapped.x).toBeCloseTo(quad[index]!.x, 4);
      expect(mapped.y).toBeCloseTo(quad[index]!.y, 4);
    });
  });

  it('handles an axis-aligned rectangle without distortion', () => {
    const quad: Quad = [
      { x: 10, y: 20 },
      { x: 210, y: 20 },
      { x: 210, y: 120 },
      { x: 10, y: 120 },
    ];
    const matrix = quadToMatrix3d(200, 100, quad);
    const centre = applyMatrix3d(matrix!, 100, 50);

    expect(centre.x).toBeCloseTo(110, 3);
    expect(centre.y).toBeCloseTo(70, 3);
  });

  it('refuses a degenerate quad instead of emitting NaNs', () => {
    const collapsed: Quad = [
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
      { x: 10, y: 10 },
    ];
    expect(quadToMatrix3d(200, 100, collapsed)).toBeNull();
    expect(isQuadUsable(collapsed)).toBe(false);
  });

  it('refuses a zero-sized source', () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(quadToMatrix3d(0, 100, quad)).toBeNull();
  });
});

describe('computeMonitorPlacements', () => {
  it('places all three monitors inside a desktop viewport', () => {
    const placements = computeMonitorPlacements(1440, 720);
    expect(placements.map((placement) => placement.id).sort()).toEqual([
      'center',
      'left',
      'right',
    ]);
  });

  it('keeps the centre monitor centred and the side monitors on their own sides', () => {
    const width = 1440;
    const placements = computeMonitorPlacements(width, 720);
    const centreOf = (id: string) => {
      const placement = placements.find((entry) => entry.id === id)!;
      const middle = applyMatrix3d(
        placement.transform,
        placement.width / 2,
        placement.height / 2,
      );
      return middle.x;
    };

    expect(centreOf('center')).toBeCloseTo(width / 2, 0);
    expect(centreOf('left')).toBeLessThan(width / 2);
    expect(centreOf('right')).toBeGreaterThan(width / 2);
  });

  it('produces a mirror-symmetric layout, because the room is symmetric', () => {
    const width = 1440;
    const placements = computeMonitorPlacements(width, 720);
    const centreOf = (id: string) => {
      const placement = placements.find((entry) => entry.id === id)!;
      return applyMatrix3d(placement.transform, placement.width / 2, placement.height / 2).x;
    };

    const leftOffset = width / 2 - centreOf('left');
    const rightOffset = centreOf('right') - width / 2;
    expect(leftOffset).toBeCloseTo(rightOffset, 0);
  });

  it('returns nothing for a zero-sized viewport rather than throwing', () => {
    expect(computeMonitorPlacements(0, 0)).toEqual([]);
    expect(computeMonitorPlacements(1440, 0)).toEqual([]);
  });

  it('is stable across repeated calls', () => {
    expect(computeMonitorPlacements(1280, 720)).toEqual(computeMonitorPlacements(1280, 720));
  });

  it('reports every monitor as being in front of the camera', () => {
    const camera = createCamera(1440, 720);
    for (const monitor of MONITORS) {
      const toMonitor = [
        monitor.position[0] - camera.position.x,
        monitor.position[1] - camera.position.y,
        monitor.position[2] - camera.position.z,
      ];
      // The seated camera looks down -Z, so every screen must be at negative Z.
      expect(toMonitor[2]!).toBeLessThan(0);
    }
  });
});
