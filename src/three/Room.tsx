import { useMemo } from 'react';

import { Prop, useSurfaceMaterial } from './assets';
import { Backdrop } from './Backdrop';
import { BACKDROP, DESK, MODEL_FILES, ROOM } from './layout';

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

  /*
   * The fourth wall, which until now did not exist.
   *
   * Nothing drew the room's front face, because with a ±55° cone nothing could
   * ever look at it: the seated player's widest glance still had the back wall
   * in frame. A chair swivel changes that completely — at the yaw clamp the
   * camera is pointing back past its own shoulder — and what it found there was
   * not a bare wall but *no* wall, so the room ended in the renderer's clear
   * colour about two and a half metres behind the seat.
   *
   * Built in the same three-piece way as the back wall and for the same reason:
   * the rear doorway has to be a genuine opening with light beyond it, not a
   * dark rectangle painted on plaster.
   */
  const rear = BACKDROP.rear;
  const rearSegments = useMemo(() => {
    const left = rear.door.x - rear.door.width / 2;
    const right = rear.door.x + rear.door.width / 2;
    return [
      { width: left + halfWidth, height: ROOM.height, x: (-halfWidth + left) / 2, y: ROOM.height / 2 },
      { width: halfWidth - right, height: ROOM.height, x: (right + halfWidth) / 2, y: ROOM.height / 2 },
      {
        width: rear.door.width,
        height: ROOM.height - rear.door.height,
        x: rear.door.x,
        y: (ROOM.height + rear.door.height) / 2,
      },
    ];
  }, [rear, halfWidth]);

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

      {/*
        * Rotated to face back down the room. A plane's front face is +Z, so
        * without the half-turn the rear wall would be lit from the wrong side
        * and back-face-culled away from the only camera that can see it.
        */}
      {rearSegments.map((segment, index) => (
        <mesh
          key={`rear-${index}`}
          position={[segment.x, segment.y, ROOM.frontZ]}
          rotation={[0, Math.PI, 0]}
          material={wallMaterial}
        >
          <planeGeometry args={[segment.width, segment.height]} />
        </mesh>
      ))}

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

      <SideAndRearFurniture />
    </group>
  );
}

/**
 * The furniture the widened head-look cone made necessary.
 *
 * Everything above this was staged for the seated forward view. A chair swivel
 * reaches 120° either way, which puts the left wall, the right-hand floor and
 * the whole area behind the operator on screen — and all three were empty. The
 * brief for this was explicit that they must not become a bare wall with a bin
 * in front of it, so each view is built in the three layers `BACKDROP.rear`
 * describes rather than decorated with one object.
 *
 * Every model here is one the room already loads. Nothing new is fetched: these
 * are additional instances of the desk, chair, cabinet and plant that
 * `MODEL_FILES` already names, so the office chunk does not grow.
 */
function SideAndRearFurniture() {
  const { credenza, pod, rear } = BACKDROP;

  return (
    <group name="side-and-rear">
      {/*
        LEFT — midground. A credenza run against the wall the acoustic band
        stops short of. `Backdrop`'s `LeftWallRun` puts the archive boxes on
        top; without those the run is two identical cabinets, which is as flat
        as the plaster it is covering.
      */}
      {credenza.units.map((unit, index) => (
        <Prop
          key={`credenza-${index}`}
          url={MODEL_FILES.cabinet}
          position={[unit.position[0], 0, unit.position[1]]}
          rotationY={unit.rotationY}
          targetHeight={0.86}
          envMapIntensity={0.4}
        />
      ))}

      {/*
        LEFT — foreground. See the note on `BACKDROP.credenza.plant`: it is
        1.15 m because the seated camera's base pitch puts anything shorter
        below the frame at this distance, not because a taller plant looks
        better.
      */}
      <Prop
        url={MODEL_FILES.plant}
        position={[credenza.plant.position[0], 0, credenza.plant.position[1]]}
        rotationY={0.9}
        targetHeight={credenza.plant.height}
        envMapIntensity={0.4}
      />

      {/*
        RIGHT — midground. The neighbouring pod: a second desk with a dark
        display on it and its chair pushed back and turned, because the person
        who sits there is currently standing at the operator's own desk giving a
        report. It is the one piece of set dressing in the room that is also a
        piece of story.
      */}
      <Prop
        url={MODEL_FILES.desk}
        position={[pod.desk.position[0], 0, pod.desk.position[1]]}
        rotationY={pod.desk.rotationY}
        targetHeight={DESK.height}
        envMapIntensity={0.3}
        tint="#58534e"
      />
      <Prop
        url={MODEL_FILES.chair}
        position={[pod.chair.position[0], 0, pod.chair.position[1]]}
        rotationY={pod.chair.rotationY}
        targetHeight={0.96}
        envMapIntensity={0.4}
      />
      {/*
        RIGHT — foreground. A floor plant between the pod and the seat, so the
        right-hand glance has something in front of the furniture rather than
        furniture against a wall.
      */}
      <Prop
        url={MODEL_FILES.plant}
        position={[pod.plant.position[0], 0, pod.plant.position[1]]}
        rotationY={-0.6}
        targetHeight={0.92}
        envMapIntensity={0.4}
      />

      {/*
        REAR — midground. A breakout table with two chairs, between the seat and
        the glazed rear wall. The desk model stands in for the table: it is the
        same object a real office would have there, and reusing it costs no new
        geometry.
      */}
      <Prop
        url={MODEL_FILES.desk}
        position={[rear.table.position[0], 0, rear.table.position[1]]}
        rotationY={rear.table.rotationY}
        targetHeight={DESK.height}
        envMapIntensity={0.3}
        tint="#55504b"
      />
      <Prop
        url={MODEL_FILES.chair}
        position={[rear.table.position[0] - 0.86, 0, rear.table.position[1] + 0.5]}
        rotationY={0.9}
        targetHeight={0.96}
        envMapIntensity={0.38}
      />
      <Prop
        url={MODEL_FILES.chair}
        position={[rear.table.position[0] + 0.82, 0, rear.table.position[1] - 0.44]}
        rotationY={-2.4}
        targetHeight={0.96}
        envMapIntensity={0.38}
      />

      {/*
        REAR — foreground. The coat stand: a vertical in the rear-left, which is
        the one part of that view with nothing tall in it. Built from primitives
        rather than loaded, because no CC0 coat stand ships with this project
        and the brief forbids producing one.
      */}
      <CoatStand />
    </group>
  );
}

/** A pole, a foot and four pegs — enough at three metres. */
function CoatStand() {
  const spec = BACKDROP.rear.coatStand;
  const [x, z] = spec.position;
  const material = useSurfaceMaterial('hardware', {
    color: '#4a443d',
    roughness: 0.6,
    metalness: 0.4,
  });

  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.012, 0]} material={material}>
        <cylinderGeometry args={[0.17, 0.19, 0.024, 12]} />
      </mesh>
      <mesh position={[0, spec.height / 2, 0]} material={material}>
        <cylinderGeometry args={[0.022, 0.026, spec.height, 10]} />
      </mesh>
      {[0, 1, 2, 3].map((index) => {
        const angle = (index * Math.PI) / 2 + 0.4;
        return (
          <mesh
            key={index}
            position={[Math.sin(angle) * 0.09, spec.height - 0.06, Math.cos(angle) * 0.09]}
            rotation={[Math.cos(angle) * 0.5, 0, -Math.sin(angle) * 0.5]}
            material={material}
          >
            <cylinderGeometry args={[0.014, 0.014, 0.18, 8]} />
          </mesh>
        );
      })}
    </group>
  );
}
