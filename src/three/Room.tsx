import { useMemo } from 'react';

import { Prop, useSurfaceMaterial } from './assets';
import { Backdrop } from './Backdrop';
import { BACKDROP, MODEL_FILES, ROOM } from './layout';

/**
 * The room shell: floor, walls and ceiling carrying real CC0 PBR materials,
 * plus the scanned props that stop it reading as a blockout.
 *
 * Everything that turns the shell into a *security operations centre* — the
 * server bay, the blinded window, the doorway and its corridor, the shelving,
 * the whiteboard, the acoustic treatment and the suspended ceiling — lives in
 * `Backdrop.tsx`. That split is deliberate: this file owns the box, that file
 * owns the composition the audit found missing.
 *
 * Primitive geometry survives only where `docs/VISUAL_RESET.md` allows it — the
 * flat planes of the shell itself. Everything a viewer registers as furniture
 * is a licensed model; see `ASSET_LICENSES.md`.
 */
export function Room() {
  const floorMaterial = useSurfaceMaterial('floor');
  /*
   * White balance, not a colour.
   *
   * The Poly Haven plaster capture is a warm beige and it was going in
   * untinted, so the largest surface in the room was also one of its warmest:
   * measured at r-b 21 against the reference wall's 12. This tint is a few
   * points of blue over red — enough to pull the scan back to neutral
   * plaster, far short of the `b - r > 18` the no-cool-hues gate fires on, and
   * nothing like a decorative blue.
   */
  const wallMaterial = useSurfaceMaterial('wall', {
    color: '#eef1f4',
    metalness: 0,
    roughness: 0.95,
  });

  const halfWidth = ROOM.width / 2;
  const depth = ROOM.frontZ - ROOM.backZ;
  const midZ = (ROOM.backZ + ROOM.frontZ) / 2;

  /*
   * The back wall is built in three pieces around the doorway rather than as
   * one plane, because the doorway has to be a genuine hole: the colleague
   * starts 1.2 m down the corridor behind it and has to be *hidden* until she
   * steps through. A dark rectangle painted on a solid wall would have her
   * fade in through masonry.
   */
  const door = BACKDROP.door;
  const doorLeft = door.position[0] - door.width / 2;
  const doorRight = door.position[0] + door.width / 2;

  const backSegments = useMemo(
    () => [
      {
        // everything left of the opening
        width: doorLeft + halfWidth,
        height: ROOM.height,
        x: (-halfWidth + doorLeft) / 2,
        y: ROOM.height / 2,
      },
      {
        // the narrow return between the opening and the right-hand corner
        width: halfWidth - doorRight,
        height: ROOM.height,
        x: (doorRight + halfWidth) / 2,
        y: ROOM.height / 2,
      },
      {
        // the head above the opening
        width: door.width,
        height: ROOM.height - door.height,
        x: door.position[0],
        y: (ROOM.height + door.height) / 2,
      },
    ],
    [doorLeft, doorRight, door.width, door.height, door.position, halfWidth],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, midZ]} material={floorMaterial}>
        <planeGeometry args={[ROOM.width, depth]} />
      </mesh>

      {backSegments.map((segment, index) => (
        <mesh
          key={index}
          position={[segment.x, segment.y, ROOM.backZ]}
          material={wallMaterial}
        >
          <planeGeometry args={[segment.width, segment.height]} />
        </mesh>
      ))}

      <mesh
        position={[-halfWidth, ROOM.height / 2, midZ]}
        rotation={[0, Math.PI / 2, 0]}
        material={wallMaterial}
      >
        <planeGeometry args={[depth, ROOM.height]} />
      </mesh>
      <mesh
        position={[halfWidth, ROOM.height / 2, midZ]}
        rotation={[0, -Math.PI / 2, 0]}
        material={wallMaterial}
      >
        <planeGeometry args={[depth, ROOM.height]} />
      </mesh>

      <Backdrop />
      <Furniture />
    </group>
  );
}

/**
 * Scanned CC0 furniture, placed by base centre.
 *
 * Re-staged for the audit's second finding — "room props exist but sit mostly
 * outside the primary composition and do not create the density the reference
 * shows". Two of these four were previously against a wall the seated player
 * never looks at, and the rack stood dead centre-right as an empty steel frame
 * with nothing on it, which is what the critical-alert capture shows.
 */
function Furniture() {
  return (
    <group>
      {/*
        The cabinet is now foreground-left rather than flat against the back
        wall: it fills the dead corner between the window shelving and the desk,
        and it is the nearest background object on that side, which is what
        gives the left half of the frame a midground at all.
      */}
      <Prop
        url={MODEL_FILES.cabinet}
        position={[-1.42, 0, -0.92]}
        rotationY={0.34}
        targetHeight={0.86}
        envMapIntensity={0.45}
      />
      {/*
        The open steel rack moved off the primary axis and now stands beside the
        server bay carrying nothing but its own structure — which is what an
        open rack in a machine room actually looks like from the side, and it
        gives the right-hand third a vertical the cabinets do not.
      */}
      <Prop
        url={MODEL_FILES.rack}
        position={[-2.16, 0, -1.4]}
        rotationY={0.24}
        targetHeight={1.72}
        envMapIntensity={0.5}
      />
      {/*
        The plant stands on the wall shelf, as in the reference — and, more to
        the point, at 1.77 m rather than on the floor, which is the only height
        at which the seated player can see it past the monitors.
      */}
      <Prop
        url={MODEL_FILES.plant}
        position={[
          BACKDROP.shelf.position[0] + BACKDROP.shelf.width / 2 - 0.16,
          BACKDROP.shelf.position[1] + 0.02,
          BACKDROP.shelf.position[2] + 0.02,
        ]}
        targetHeight={0.42}
        envMapIntensity={0.4}
      />
      {/* Floor clutter, pulled inboard so it is inside the frame rather than beside it. */}
      <Prop
        url={MODEL_FILES.bin}
        position={[1.06, 0, 0.42]}
        rotationY={0.4}
        targetHeight={0.42}
        envMapIntensity={0.4}
      />
    </group>
  );
}
