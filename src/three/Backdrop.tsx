import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { BACKDROP, PALETTE, ROOM } from './layout';

/**
 * The SOC backdrop — everything behind and beside the workstation.
 *
 * The final release audit's first visual finding is that "the background is
 * dominated by a flat blank wall rather than a believable SOC with
 * window/blinds, ceiling detail, server equipment and working depth", and that
 * "room props exist but sit mostly outside the primary composition". Both are
 * accurate: measured off `docs/screenshots/1440x900-03-critical-alert.png`,
 * about a third of the seated frame was bare plaster, and the one piece of
 * equipment in shot was an empty shelving rack.
 *
 * This module is the answer, and it is built rather than downloaded on purpose.
 * The audit's own "fastest free improvement path" says to improve composition
 * with what is already in the repository and to "prefer baked and lightweight
 * improvements over mandatory heavy post-processing". Every surface here is
 * primitive geometry carrying the Poly Haven materials the room already ships;
 * nothing is fetched, so the 12 MB first-load budget does not move at all.
 *
 * Three rules hold throughout, and each of them is a gate:
 *
 * - **Warm-neutral only.** `tests/e2e/palette.spec.ts` classifies every pixel
 *   and fails on `b - r > 18`. The street outside the window is sodium, the
 *   corridor past the door is tungsten, and the rack LEDs are amber and red.
 *   There is no blue night sky here because there cannot be one.
 * - **Emissive, not illuminant.** Every glowing surface below is a
 *   `MeshBasicMaterial` with `toneMapped: false`. Adding real lights would
 *   recompile every PBR program in the room (the reason `Monitors.tsx` keeps
 *   an intensity-0 light rather than unmounting it), and the frame budget is
 *   held at 55 FPS. Only the colleague gets a real light, in `OfficeScene`.
 * - **Instanced where it repeats.** 168 rack LEDs, 44 ceiling rails and 22
 *   blind slats are three draw calls, not 234.
 */

/** Shared geometry: one box and one plane, scaled per instance. */
const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

interface Placement {
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
}

/**
 * An instanced set of unit boxes.
 *
 * `useLayoutEffect` rather than `useEffect`: the matrices have to be written
 * before the first frame the demand-renderer draws, or the whole batch appears
 * at the origin for one frame and then jumps into place.
 */
function Boxes({
  placements,
  material,
  colors,
}: {
  placements: Placement[];
  material: THREE.Material;
  colors?: THREE.Color[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    placements.forEach((placement, index) => {
      euler.set(...(placement.rotation ?? [0, 0, 0]));
      quaternion.setFromEuler(euler);
      matrix.compose(
        new THREE.Vector3(...placement.position),
        quaternion,
        new THREE.Vector3(...placement.scale),
      );
      mesh.setMatrixAt(index, matrix);
      if (colors?.[index]) mesh.setColorAt(index, colors[index]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [placements, colors]);

  return (
    <instancedMesh
      ref={ref}
      args={[UNIT_BOX, material, placements.length]}
      count={placements.length}
    />
  );
}

function buildMaterials() {
    const standard = (color: string, roughness: number, metalness = 0) =>
      new THREE.MeshStandardMaterial({ color, roughness, metalness });
    const emissive = (color: string) =>
      new THREE.MeshBasicMaterial({ color, toneMapped: false });

  return {
      rackShell: standard(PALETTE.rackShell, 0.62, 0.45),
      rackMesh: standard(PALETTE.rackMesh, 0.9, 0.1),
      rackRail: standard(PALETTE.rackRail, 0.5, 0.6),
      /*
       * White base colour, per-instance colour in `instanceColor`. Three.js
       * multiplies the two, so a white base is what lets each LED carry its own
       * value; a tinted base would multiply twice and mute every one of them.
       */
      led: new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      frame: standard('#4a443d', 0.55, 0.5),
      /*
       * The blind reads as a dark bundle against a lit street, not as a pale
       * surface: it is backlit, and the previous near-white value put a khaki
       * slab across the brightest part of the frame.
       */
      slat: standard('#4b453d', 0.78, 0.06),
      /** Sodium haze above the roofline. */
      sky: emissive('#3f2a10'),
      /** Lit windows in the building opposite. */
      street: emissive(PALETTE.streetGlow),
      /** The mass of that building. */
      streetDark: emissive('#171109'),
      corridor: emissive(PALETTE.doorGlow),
      corridorWall: standard('#3a342d', 0.9),
      sconce: emissive('#a5804f'),
      shelf: standard('#48433d', 0.82, 0.05),
      binder: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 }),
      board: standard(PALETTE.whiteboard, 0.42, 0),
      marker: standard(PALETTE.marker, 0.75),
      sticky: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
      foam: standard(PALETTE.acousticFoam, 0.98),
      tile: standard(PALETTE.ceilingTile, 0.95),
      rail: standard(PALETTE.ceilingRail, 0.6, 0.35),
      troffer: emissive(PALETTE.trofferGlow),
      trofferLit: emissive('#e6e3dd'),
      tray: standard('#2d2a27', 0.7, 0.5),
      lampShade: emissive('#ab7f49'),
  } as const;
}

type Materials = ReturnType<typeof buildMaterials>;

export function Backdrop() {
  const materials = useMemo(buildMaterials, []);

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  return (
    <group name="backdrop">
      <ServerBay materials={materials} />
      <BlindedWindow materials={materials} />
      <Doorway materials={materials} />
      <Shelving materials={materials} />
      <Whiteboard materials={materials} />
      <AcousticTreatment materials={materials} />
      <SuspendedCeiling materials={materials} />
      <RearWall materials={materials} />
      <LeftWallRun materials={materials} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * The server bay
 * ------------------------------------------------------------------ */

/**
 * Two cabinets behind the right-hand monitors, their status LEDs facing the
 * seat.
 *
 * This is the single object that makes the room read as a security operations
 * centre rather than as an office with three screens in it, which is why it
 * sits inside the primary composition instead of against a side wall where the
 * old `worn_metal_rack` prop was parked. It also earns its place twice: the
 * colleague settles 0.8 m in front of it, so the lit rows are what separate her
 * silhouette from the wall while she reports.
 */
function ServerBay({ materials }: { materials: Materials }) {
  const { rack, rails, leds, ledColors } = useMemo(() => {
    const spec = BACKDROP.racks;
    const railPlacements: Placement[] = [];
    const ledPlacements: Placement[] = [];
    const colors: THREE.Color[] = [];

    const live = new THREE.Color(PALETTE.ledLive);
    const dim = new THREE.Color(PALETTE.ledDim);
    const critical = new THREE.Color(PALETTE.critical);

    spec.positions.forEach(([x, z], cabinet) => {
      const front = z + spec.depth / 2 + 0.004;
      for (let row = 0; row < spec.rows; row += 1) {
        const y = 0.2 + row * ((spec.height - 0.34) / (spec.rows - 1));
        railPlacements.push({
          position: [x, y, front],
          scale: [spec.width - 0.06, 0.016, 0.012],
        });
        for (let slot = 0; slot < spec.perRow; slot += 1) {
          ledPlacements.push({
            position: [
              x - spec.width / 2 + 0.09 + slot * ((spec.width - 0.18) / (spec.perRow - 1)),
              y + 0.026,
              front + 0.004,
            ],
            scale: [0.013, 0.007, 0.004],
          });
          /*
           * A deterministic scatter, not `Math.random()`: the room has to look
           * the same in every screenshot the review compares, and a rack whose
           * LEDs move between captures makes a before/after pair unreadable.
           * Most units idle, a handful are working, and two are in trouble —
           * which is the story the case is telling anyway.
           */
          const seed = (cabinet * 977 + row * 31 + slot * 7) % 23;
          colors.push(seed === 3 ? critical : seed % 4 === 0 ? live : dim);
        }
      }
    });

    return {
      rack: spec,
      rails: railPlacements,
      leds: ledPlacements,
      ledColors: colors,
    };
  }, []);

  return (
    <group>
      {rack.positions.map(([x, z], index) => (
        <group key={index} position={[x, 0, z]}>
          {/* cabinet body */}
          <mesh position={[0, rack.height / 2, 0]} material={materials.rackShell}>
            <boxGeometry args={[rack.width, rack.height, rack.depth]} />
          </mesh>
          {/* recessed mesh front, so the rails and LEDs sit in a dark well */}
          <mesh
            position={[0, rack.height / 2, rack.depth / 2 + 0.002]}
            material={materials.rackMesh}
          >
            <planeGeometry args={[rack.width - 0.05, rack.height - 0.1]} />
          </mesh>
          {/* plinth and top cap: the two silhouette breaks that stop it reading as a slab */}
          <mesh position={[0, 0.05, 0]} material={materials.rackRail}>
            <boxGeometry args={[rack.width + 0.03, 0.1, rack.depth + 0.03]} />
          </mesh>
          <mesh position={[0, rack.height + 0.02, 0]} material={materials.rackRail}>
            <boxGeometry args={[rack.width + 0.04, 0.04, rack.depth + 0.04]} />
          </mesh>
        </group>
      ))}

      <Boxes placements={rails} material={materials.rackRail} />
      <Boxes placements={leds} material={materials.led} colors={ledColors} />
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Window and blinds
 * ------------------------------------------------------------------ */

/**
 * The window, half-blinded, onto a sodium-lit street.
 *
 * The previous window was on the left-hand *side* wall, outside the seated
 * front frame, and its glass was `#0f0c0a` behind unlit slats — so the one
 * capture that did contain it (`docs/screenshots/office-view-left.png`) shows a
 * black rectangle on a blank wall. It is on the back wall now, inside the
 * primary composition, and it is lit: the far side of a night street is the
 * brightest thing in a dark office, and a window that is darker than the wall
 * around it reads as a hole, not as a window.
 */
function BlindedWindow({ materials }: { materials: Materials }) {
  const spec = BACKDROP.window;
  const [x, y, z] = spec.position;
  const halfWidth = spec.width / 2;
  const halfHeight = spec.height / 2;

  /**
   * The blind, drawn over the top half with the slats tilted open.
   *
   * Twice re-cut, and the geometry that matters is the *gap*. The first attempt
   * used 50 mm slats on a 51 mm pitch, which is a solid panel: the window
   * rendered as a khaki slab in the brightest part of the frame. These are
   * 26 mm slats on a 62 mm pitch, tilted 0.42 rad, so a little over half of the
   * glazing behind them shows through as the thin bright lines a backlit
   * venetian actually reads as. The slat material is dark for the same reason —
   * it is lit from behind, not from the room.
   */
  const slats = useMemo(() => {
    const out: Placement[] = [];
    for (let index = 0; index < spec.slats; index += 1) {
      out.push({
        position: [x, y + halfHeight - 0.09 - index * 0.062, z + 0.05],
        scale: [spec.width - 0.05, 0.026, 0.01],
        rotation: [0.42, 0, 0],
      });
    }
    return out;
  }, [spec, x, y, z, halfHeight]);

  /**
   * The building opposite: a dark mass across the lower half of the glazing
   * with two rows of lit windows along its upper floors.
   *
   * They were at the very bottom of the frame before, which put every one of
   * them behind the left monitor. These sit in the band the player can see.
   */
  const cityscape = useMemo(() => {
    const out: Placement[] = [];
    const columns = 5;
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        // A deterministic scatter: two of the ten are dark, as they would be.
        if ((row * columns + column) % 7 === 3) continue;
        out.push({
          position: [
            x - spec.width / 2 + 0.2 + column * ((spec.width - 0.4) / (columns - 1)),
            y - halfHeight + 0.3 + row * 0.19,
            z + 0.012,
          ],
          scale: [0.12, 0.075, 0.002],
        });
      }
    }
    return out;
  }, [spec, x, y, z, halfHeight]);

  return (
    <group>
      {/*
        Depth order matters more here than anywhere else in the room, and it is
        the one thing that went wrong on the first attempt: a near-opaque glass
        plane was mounted in *front* of the glow and the cityscape, so the whole
        window rendered as a black rectangle on the wall — the exact defect the
        audit had already found in the old side-wall window. There is no glass
        pane now. A night window seen from a dark room shows the street, not the
        glass; the reflection a real pane would carry is worth less than the one
        genuinely bright surface in the left half of the frame.

        Order, back to front: sky glow, the dark mass of the building opposite,
        its lit windows, then the blinds.
      */}
      <mesh position={[x, y, z + 0.005]} material={materials.sky}>
        <planeGeometry args={[spec.width, spec.height]} />
      </mesh>
      <mesh
        position={[x, y - spec.height * 0.19, z + 0.008]}
        material={materials.streetDark}
      >
        <planeGeometry args={[spec.width, spec.height * 0.62]} />
      </mesh>
      <Boxes placements={cityscape} material={materials.street} />

      {/* head rail the blind hangs from */}
      <mesh position={[x, y + halfHeight - 0.03, z + 0.05]} material={materials.frame}>
        <boxGeometry args={[spec.width - 0.02, 0.05, 0.05]} />
      </mesh>
      <Boxes placements={slats} material={materials.slat} />

      {/* reveal: the frame is four boxes, so the window has a thickness */}
      <mesh position={[x, y + halfHeight + 0.04, z + 0.04]} material={materials.frame}>
        <boxGeometry args={[spec.width + 0.16, 0.08, 0.1]} />
      </mesh>
      <mesh position={[x, y - halfHeight - 0.04, z + 0.04]} material={materials.frame}>
        <boxGeometry args={[spec.width + 0.16, 0.08, 0.14]} />
      </mesh>
      <mesh position={[x - halfWidth - 0.04, y, z + 0.04]} material={materials.frame}>
        <boxGeometry args={[0.08, spec.height + 0.16, 0.1]} />
      </mesh>
      <mesh position={[x + halfWidth + 0.04, y, z + 0.04]} material={materials.frame}>
        <boxGeometry args={[0.08, spec.height + 0.16, 0.1]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Doorway and corridor
 * ------------------------------------------------------------------ */

/**
 * A real opening in the back wall with a lit corridor behind it.
 *
 * This exists so the colleague's entrance is an entrance. `COLLEAGUE_PATH`
 * starts 1.2 m down this corridor, where the wall hides her completely, and she
 * walks out through an opening the player can see — instead of resolving out of
 * the dark beside the operator's own shoulder, which is where the old path
 * started. `Room.tsx` builds the back wall in segments around this hole.
 *
 * The corridor is also the room's one piece of deep background: it is 1.4 m of
 * space past a wall 3 m away, which is what stops the frame ending flat.
 */
function Doorway({ materials }: { materials: Materials }) {
  const spec = BACKDROP.door;
  const [x, , z] = spec.position;
  const halfWidth = spec.width / 2;
  const jamb = 0.07;

  return (
    <group>
      {/* corridor: floor, two walls and a lit end plane */}
      <mesh position={[x, 0.002, z - 0.72]} rotation={[-Math.PI / 2, 0, 0]} material={materials.corridorWall}>
        <planeGeometry args={[spec.width + 0.4, 1.5]} />
      </mesh>
      <mesh
        position={[x - halfWidth - 0.18, 1.05, z - 0.72]}
        rotation={[0, Math.PI / 2, 0]}
        material={materials.corridorWall}
      >
        <planeGeometry args={[1.5, 2.1]} />
      </mesh>
      <mesh
        position={[x + halfWidth + 0.18, 1.05, z - 0.72]}
        rotation={[0, -Math.PI / 2, 0]}
        material={materials.corridorWall}
      >
        <planeGeometry args={[1.5, 2.1]} />
      </mesh>
      {/*
        The corridor's far end. Emissive rather than lit: it is the only warm
        mass in the right third of the frame, and a real light there would spill
        onto the back wall it is meant to be beyond.
      */}
      <mesh position={[x, 1.05, z - 1.44]} material={materials.corridor}>
        <planeGeometry args={[spec.width + 0.36, 2.1]} />
      </mesh>

      {/* the frame itself */}
      <mesh position={[x - halfWidth - jamb / 2, spec.height / 2, z + 0.03]} material={materials.frame}>
        <boxGeometry args={[jamb, spec.height + jamb, 0.16]} />
      </mesh>
      <mesh position={[x + halfWidth + jamb / 2, spec.height / 2, z + 0.03]} material={materials.frame}>
        <boxGeometry args={[jamb, spec.height + jamb, 0.16]} />
      </mesh>
      <mesh position={[x, spec.height + jamb / 2, z + 0.03]} material={materials.frame}>
        <boxGeometry args={[spec.width + jamb * 2, jamb, 0.16]} />
      </mesh>

      {/* wall sconce above the door, as in the reference */}
      <mesh position={[x, spec.height + 0.28, z + 0.09]} material={materials.frame}>
        <boxGeometry args={[0.34, 0.1, 0.12]} />
      </mesh>
      <mesh position={[x, spec.height + 0.23, z + 0.09]} material={materials.sconce}>
        <boxGeometry args={[0.3, 0.02, 0.1]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Shelving
 * ------------------------------------------------------------------ */

/**
 * The wall shelf between the window and the server bay: binders, a warm lamp,
 * and the potted plant on its right-hand end.
 *
 * This is the object that fills the last piece of bare plaster in the seated
 * frame. Everything on it lives in the 60-pixel band above the monitor tops, so
 * it is deliberately shallow and its contents are deliberately tall — a squat
 * arrangement here would be invisible.
 */
function Shelving({ materials }: { materials: Materials }) {
  const spec = BACKDROP.shelf;
  const [x, y, z] = spec.position;

  const { carcass, binders, binderColors } = useMemo(() => {
    const shelves: Placement[] = [
      { position: [x, y, z], scale: [spec.width, 0.035, spec.depth] },
      // brackets, so it reads as fixed to the wall rather than as a floating slab
      {
        position: [x - spec.width / 2 + 0.14, y - 0.09, z - 0.04],
        scale: [0.03, 0.16, spec.depth * 0.7],
      },
      {
        position: [x + spec.width / 2 - 0.14, y - 0.09, z - 0.04],
        scale: [0.03, 0.16, spec.depth * 0.7],
      },
    ];

    const files: Placement[] = [];
    const colors: THREE.Color[] = [];
    // Ring binders, one of them leaning, warm-neutral and varied only in value
    // so the row reads as objects rather than as one striped block.
    const shades = ['#6b5a49', '#7f6c57', '#544639', '#8a7660', '#453a31'];
    for (let index = 0; index < 8; index += 1) {
      const lean = index === 6 ? 0.2 : 0;
      files.push({
        position: [x - spec.width / 2 + 0.09 + index * 0.062, y + 0.17, z + 0.01],
        scale: [0.05, 0.3, spec.depth * 0.7],
        rotation: [0, 0, lean],
      });
      colors.push(new THREE.Color(shades[index % shades.length]!));
    }

    return { carcass: shelves, binders: files, binderColors: colors };
  }, [spec, x, y, z]);

  return (
    <group>
      <Boxes placements={carcass} material={materials.shelf} />
      <Boxes placements={binders} material={materials.binder} colors={binderColors} />
      {/* the small warm lamp the reference puts beside the binders */}
      <mesh position={[x + 0.12, y + 0.115, z + 0.03]} material={materials.frame}>
        <cylinderGeometry args={[0.05, 0.06, 0.02, 12]} />
      </mesh>
      <mesh position={[x + 0.12, y + 0.2, z + 0.03]} material={materials.lampShade}>
        <cylinderGeometry args={[0.062, 0.085, 0.14, 14]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Whiteboard
 * ------------------------------------------------------------------ */

/**
 * The whiteboard on the right-hand wall.
 *
 * It carries the right head-look limit, which measured 38.7 mean luminance over
 * a wall that was 60% empty. A board is the one object in an office that is
 * genuinely brighter than its wall, so it does real work in that view.
 */
function Whiteboard({ materials }: { materials: Materials }) {
  const spec = BACKDROP.whiteboard;
  const [x, y, z] = spec.position;

  const { strokes, stickies, stickyColors } = useMemo(() => {
    /*
     * A loose incident-response flow: three boxes, two joins and a branch.
     * Deliberately abstract — legible marks at four metres, not readable text,
     * which would be illegible anyway and would need translating.
     */
    const marks: Placement[] = [
      { position: [-0.42, 0.22, 0.012], scale: [0.3, 0.012, 0.004] },
      { position: [-0.42, 0.02, 0.012], scale: [0.3, 0.012, 0.004] },
      { position: [-0.57, 0.12, 0.012], scale: [0.012, 0.2, 0.004] },
      { position: [-0.27, 0.12, 0.012], scale: [0.012, 0.2, 0.004] },
      { position: [-0.05, 0.12, 0.012], scale: [0.32, 0.01, 0.004] },
      { position: [0.16, 0.22, 0.012], scale: [0.26, 0.012, 0.004] },
      { position: [0.16, 0.02, 0.012], scale: [0.26, 0.012, 0.004] },
      { position: [0.03, 0.12, 0.012], scale: [0.012, 0.2, 0.004] },
      { position: [0.29, 0.12, 0.012], scale: [0.012, 0.2, 0.004] },
      { position: [0.45, 0.12, 0.012], scale: [0.24, 0.01, 0.004] },
      { position: [0.58, -0.1, 0.012], scale: [0.01, 0.44, 0.004] },
      { position: [-0.3, -0.3, 0.012], scale: [0.5, 0.008, 0.004] },
      { position: [-0.3, -0.36, 0.012], scale: [0.38, 0.008, 0.004] },
    ];
    const notes: Placement[] = [];
    const colors: THREE.Color[] = [];
    const shades = ['#d9c07a', '#d8a463', '#cfc189', '#d9b06a'];
    for (let index = 0; index < 4; index += 1) {
      notes.push({
        position: [-0.6 + index * 0.16, 0.4, 0.014],
        scale: [0.085, 0.085, 0.003],
        rotation: [0, 0, index % 2 ? 0.09 : -0.06],
      });
      colors.push(new THREE.Color(shades[index]!));
    }
    return { strokes: marks, stickies: notes, stickyColors: colors };
  }, []);

  return (
    <group position={[x, y, z]} rotation={[0, -Math.PI / 2, 0]}>
      <mesh position={[0, 0, -0.02]} material={materials.frame}>
        <boxGeometry args={[spec.width + 0.06, spec.height + 0.06, 0.04]} />
      </mesh>
      <mesh material={materials.board}>
        <planeGeometry args={[spec.width, spec.height]} />
      </mesh>
      <Boxes placements={strokes} material={materials.marker} />
      <Boxes placements={stickies} material={materials.sticky} colors={stickyColors} />
      {/* pen tray */}
      <mesh position={[0, -spec.height / 2 - 0.05, 0.03]} material={materials.frame}>
        <boxGeometry args={[spec.width * 0.5, 0.03, 0.07]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ *
 * Acoustic treatment
 * ------------------------------------------------------------------ */

/**
 * Wedge foam on both side walls, near the back.
 *
 * The reference frames the whole composition between two columns of acoustic
 * panels, and they do more than dress the wall: a matte black-brown grid breaks
 * up the one surface in the room with no other detail on it, and it gives the
 * left and right head-look limits something with structure at the frame edge.
 */
function AcousticTreatment({ materials }: { materials: Materials }) {
  const panels = useMemo(() => {
    const spec = BACKDROP.acoustic;
    const out: Placement[] = [];
    const halfWidth = ROOM.width / 2;
    for (const side of [-1, 1]) {
      for (let column = 0; column < 2; column += 1) {
        for (let row = 0; row < spec.count; row += 1) {
          out.push({
            position: [
              side * (halfWidth - 0.03),
              spec.top - row * (spec.size + 0.03),
              ROOM.backZ + 0.34 + column * (spec.size + 0.03),
            ],
            scale: [0.055, spec.size, spec.size],
          });
        }
      }
    }
    return out;
  }, []);

  return <Boxes placements={panels} material={materials.foam} />;
}

/* ------------------------------------------------------------------ *
 * Suspended ceiling
 * ------------------------------------------------------------------ */

/**
 * T-bar grid, two troffers and a cable tray.
 *
 * `ROOM.height` came down to 2.52 m for this: at 2.70 m none of it was ever in
 * the seated frame, so a ceiling would have been geometry nobody could see. At
 * 2.52 m the grid and the lit troffer are inside the cone, and the up-pitch
 * head-look limit finally has something above it.
 */
function SuspendedCeiling({ materials }: { materials: Materials }) {
  const spec = BACKDROP.ceiling;
  const depth = ROOM.frontZ - ROOM.backZ;
  const midZ = (ROOM.backZ + ROOM.frontZ) / 2;
  const y = ROOM.height - 0.015;

  /*
   * The T-bars hang *below* the tiles, which is both what a suspended ceiling
   * does and the difference between a grid and no grid at all: on the first
   * pass the rails sat 5 mm above the tile plane, so the tiles occluded every
   * one of them and the ceiling rendered as one flat smear.
   */
  const rails = useMemo(() => {
    const out: Placement[] = [];
    const railY = y - 0.022;
    for (let index = 0; index <= spec.tileX; index += 1) {
      out.push({
        position: [-ROOM.width / 2 + index * (ROOM.width / spec.tileX), railY, midZ],
        scale: [0.04, 0.026, depth],
      });
    }
    for (let index = 0; index <= spec.tileZ; index += 1) {
      out.push({
        position: [0, railY, ROOM.backZ + index * (depth / spec.tileZ)],
        scale: [ROOM.width, 0.026, 0.04],
      });
    }
    return out;
  }, [spec, depth, midZ, y]);

  const tray = useMemo(
    () => [
      { position: [0, ROOM.height - 0.12, spec.trayZ], scale: [ROOM.width, 0.05, 0.22] } as Placement,
      { position: [0, ROOM.height - 0.16, spec.trayZ - 0.1], scale: [ROOM.width, 0.03, 0.02] } as Placement,
      { position: [0, ROOM.height - 0.16, spec.trayZ + 0.1], scale: [ROOM.width, 0.03, 0.02] } as Placement,
    ],
    [spec],
  );

  return (
    <group>
      <Boxes placements={rails} material={materials.rail} />
      <Boxes placements={tray} material={materials.tray} />

      {spec.troffers.map((troffer, index) => (
        <group key={index} position={[troffer.position[0], y - 0.03, troffer.position[1]]}>
          <mesh material={materials.rail}>
            <boxGeometry args={[1.18, 0.06, 0.6]} />
          </mesh>
          <mesh
            position={[0, -0.032, 0]}
            rotation={[Math.PI / 2, 0, 0]}
            material={troffer.lit ? materials.trofferLit : materials.troffer}
          >
            <planeGeometry args={[1.1, 0.52]} />
          </mesh>
        </group>
      ))}

      {/* the tiles themselves: one plane, the grid below reads as the joins */}
      <mesh
        position={[0, ROOM.height - 0.008, midZ]}
        rotation={[Math.PI / 2, 0, 0]}
        material={materials.tile}
      >
        <planeGeometry args={[ROOM.width, depth]} />
      </mesh>
    </group>
  );
}

export { UNIT_PLANE };

/* ------------------------------------------------------------------ *
 * The rear wall, and the left-hand run
 *
 * Both exist for the widened head-look cone. Everything above this line was
 * composed for the seated forward view and about 55° either side of it; a chair
 * swivel reaches 120°, which puts the back of the room and four metres of the
 * left wall on screen for the first time.
 *
 * The rule these follow is the one `BACKDROP.rear` states: three depth layers
 * per view, never one object against a flat surface. A wall with a single
 * poster on it and a bin in front of it is not a background, it is a wall with
 * a poster and a bin.
 * ------------------------------------------------------------------ */

/**
 * What the operator sees when they turn all the way round: a glazed partition
 * onto the lit floor beyond, a status board, a clock, and a doorway.
 *
 * The glazing does the same job the doorway's corridor does on the back wall —
 * it gives the rear depth rather than terminating it. Without it the rear view
 * is a correctly-lit flat plane, which is better than the hole that was there
 * before and still reads as the end of a set.
 */
function RearWall({ materials }: { materials: Materials }) {
  const spec = BACKDROP.rear;
  const z = ROOM.frontZ;
  const halfWidth = ROOM.width / 2;

  const { mullions, boardRows, boardColors } = useMemo(() => {
    const bars: Placement[] = [];
    const glazingHeight = spec.glazing.top - spec.glazing.bottom;
    const midY = (spec.glazing.top + spec.glazing.bottom) / 2;

    // Head and cill of the glazed band.
    for (const y of [spec.glazing.bottom, spec.glazing.top]) {
      bars.push({ position: [0, y, z - 0.04], scale: [ROOM.width, 0.05, 0.08] });
    }
    // Vertical mullions every 0.86 m, which is what makes it read as glazing
    // rather than as a lighter stripe of paint.
    for (let x = -halfWidth + 0.43; x < halfWidth; x += 0.86) {
      bars.push({ position: [x, midY, z - 0.04], scale: [0.05, glazingHeight, 0.08] });
    }

    /*
     * The status board's live rows. Warm-neutral values only: the palette gate
     * in `tests/e2e/palette.spec.ts` fires on `b - r > 18`, and a wall of cool
     * blue "monitoring" rows is exactly the thing that would trip it.
     */
    const rows: Placement[] = [];
    const colors: THREE.Color[] = [];
    const live = new THREE.Color(PALETTE.ledLive);
    const dim = new THREE.Color(PALETTE.ledDim);
    for (let row = 0; row < spec.board.rows; row += 1) {
      const y = spec.board.position[1] - spec.board.height / 2 + 0.09 + row * 0.09;
      const width = spec.board.width * (0.28 + ((row * 7) % 5) * 0.12);
      rows.push({
        position: [spec.board.position[0] - spec.board.width / 2 + width / 2 + 0.08, y, z - 0.085],
        scale: [width, 0.026, 0.004],
      });
      colors.push(row % 3 === 1 ? live : dim);
    }

    return { mullions: bars, boardRows: rows, boardColors: colors };
  }, [spec, z, halfWidth]);

  return (
    <group>
      {/*
        The floor beyond the glazing, and beyond the doorway.

        One emissive plane set back from the wall rather than a modelled space:
        it is 2.6 m behind the seat and read through mullions, so what it has to
        supply is a value and a suggestion of depth, not a room.
      */}
      <mesh position={[0, 1.5, z + 0.36]} rotation={[0, Math.PI, 0]} material={materials.corridorWall}>
        <planeGeometry args={[ROOM.width, 2.6]} />
      </mesh>
      <mesh position={[0, 1.62, z + 0.3]} rotation={[0, Math.PI, 0]} material={materials.corridor}>
        <planeGeometry args={[ROOM.width * 0.82, 0.5]} />
      </mesh>

      <Boxes placements={mullions} material={materials.frame} />

      {/* the status board: dark glass in a frame, with its rows lit */}
      <mesh position={[spec.board.position[0], spec.board.position[1], z - 0.06]} rotation={[0, Math.PI, 0]} material={materials.frame}>
        <planeGeometry args={[spec.board.width + 0.05, spec.board.height + 0.05]} />
      </mesh>
      <mesh position={[spec.board.position[0], spec.board.position[1], z - 0.07]} rotation={[0, Math.PI, 0]} material={materials.slat}>
        <planeGeometry args={[spec.board.width, spec.board.height]} />
      </mesh>
      <Boxes placements={boardRows} material={materials.led} colors={boardColors} />

      {/* the clock */}
      <mesh position={[spec.clock.position[0], spec.clock.position[1], z - 0.06]} rotation={[0, Math.PI, 0]} material={materials.board}>
        <circleGeometry args={[spec.clock.radius, 24]} />
      </mesh>
      <mesh position={[spec.clock.position[0], spec.clock.position[1], z - 0.07]} rotation={[0, Math.PI, 0]} material={materials.frame}>
        <ringGeometry args={[spec.clock.radius * 0.92, spec.clock.radius, 24]} />
      </mesh>
      {/* two hands, so it reads as a clock rather than as a white disc */}
      <mesh position={[spec.clock.position[0], spec.clock.position[1] + 0.04, z - 0.08]} material={materials.marker}>
        <boxGeometry args={[0.012, 0.09, 0.004]} />
      </mesh>
      <mesh
        position={[spec.clock.position[0] + 0.045, spec.clock.position[1], z - 0.08]}
        rotation={[0, 0, Math.PI / 2]}
        material={materials.marker}
      >
        <boxGeometry args={[0.01, 0.1, 0.004]} />
      </mesh>
    </group>
  );
}

/**
 * The credenza run along the left wall, with archive boxes on top.
 *
 * The units themselves are `drawer_cabinet.glb` placed by `Furniture` in
 * `Room.tsx` — this owns the part that gives the run a silhouette, because a
 * row of identical cabinets is as flat as the wall it is hiding.
 */
function LeftWallRun({ materials }: { materials: Materials }) {
  const boxes = useMemo(
    () =>
      BACKDROP.credenza.boxes.map((box) => ({
        position: box.position,
        scale: [box.scale, box.scale * 0.72, box.scale * 1.2] as [number, number, number],
        rotation: [0, box.position[2] * 0.4, 0] as [number, number, number],
      })),
    [],
  );

  return <Boxes placements={boxes} material={materials.shelf} />;
}
