import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { Prop } from './assets';
import { chamferedUnitBox, sharedChamferedBox } from './bevelGeometry';
import { DESK, MODEL_FILES } from './layout';
import { grainNormalMap, roughnessVariation, variedRoughness } from './proceduralMaps';
import {
  HUB,
  KEYBOARD_INDICATORS,
  MOUSE_ORIGIN,
  MOUSE_YAW,
  PLATE,
  SURFACE,
  buildKeyField,
  cableRuns,
  type Cap,
} from './workstationGeometry';

/**
 * The workstation: a scanned CC0 desk and chair, the scanned lamp that lights
 * the scene, and the scanned clutter that sells the foreground.
 *
 * The keyboard, the mouse and the cable runs are modelled here rather than
 * loaded, because no CC0 source reachable from this environment publishes them —
 * the gap and the three sources tried are recorded in `docs/ASSET_PIPELINE.md`.
 *
 * They no longer carry the Poly Haven painted-metal scan. That set was a
 * photograph of sheet steel standing in for moulded plastic, which is the same
 * mismatch the previous pass removed it from the monitor bezels for; what is
 * left in its place is a plastic material with a plastic's response, and the
 * fidelity comes from correct dimensions and real geometry instead. See
 * `Keyboard` below and `ASSET_LICENSES.md`.
 */
export function Workstation() {
  return (
    <group>
      {/*
        * Fitted by height, not width: the desk's top surface then lands exactly
        * on `DESK.height`, which is the datum the monitors, keyboard and every
        * prop on the desk are positioned against.
        */}
      <Prop
        url={MODEL_FILES.desk}
        position={[0, 0, DESK.z]}
        targetHeight={DESK.height}
        envMapIntensity={0.35}
        /* The desk top is the surface every contact shadow lands on. */
        receiveShadow
        /*
         * Darkened from `#6a5f55`. The desk fills the bottom third of the
         * frame, so its value sets the value of the whole foreground, and at
         * the old tint the practical turned that third into a sheet of orange.
         * The reference's desk is dark walnut under a black mat; this is the
         * same relationship.
         */
        tint="#58534e"
      />
      <Prop
        url={MODEL_FILES.chair}
        position={[0.04, 0, 1.3]}
        rotationY={Math.PI}
        targetHeight={0.96}
        envMapIntensity={0.45}
      />
      <Prop
        url={MODEL_FILES.lamp}
        position={[-1.0, DESK.height, DESK.z - 0.2]}
        rotationY={0.8}
        targetHeight={0.4}
        envMapIntensity={0.5}
        tint="#68625b"
      />
      {/*
        The desk clutter, moved into the near foreground.
        `docs/assets/office-concept-v2-neutral.png` fills the bottom quarter of
        the frame with objects — a mug on a coaster, a pad and pen, sticky
        notes, a pen pot, a paper tray — and that band is what gives the picture
        its nearest layer. These sat at the far edge of the desk before, level
        with the monitor feet, which put every one of them in the midground and
        left the foreground as bare veneer.
      */}
      {/*
        * Both of these were going in untinted, and a Poly Haven scan is lit for
        * daylight: the pencils came through as bright gold sticks and the pads
        * as orange cards, in the nearest, most-read band of the picture. These
        * tints carry a few points of blue over red, which is white balance
        * rather than a colour — the same correction the plaster wall gets in
        * `Room.tsx`, and far short of the `b - r > 18` the no-cool-hues gate
        * fires on.
        */}
      <Prop
        url={MODEL_FILES.notepads}
        position={[-0.46, DESK.height, DESK.z - 0.02]}
        rotationY={0.34}
        targetWidth={0.2}
        envMapIntensity={0.4}
        tint="#cfccc8"
        castShadow
      />
      <Prop
        url={MODEL_FILES.stationery}
        position={[0.64, DESK.height, DESK.z + 0.02]}
        rotationY={-0.42}
        targetWidth={0.2}
        envMapIntensity={0.45}
        tint="#c2c6cc"
        castShadow
      />
      <Prop
        url={MODEL_FILES.thermos}
        position={[-0.86, DESK.height, DESK.z - 0.16]}
        targetHeight={0.17}
        envMapIntensity={0.5}
        castShadow
      />

      <Keyboard />
      <Mouse />
      <DeskMat />
      <DeskClutter />
      <Cables />
    </group>
  );
}

/**
 * One chamfered unit box, scaled per instance. Shared, so it is never rebuilt.
 *
 * `docs/NODELESS_SOC_REDESIGN_2026-08-31.md` §8 names keycaps among the hero
 * hard-surface objects, and a keycap is the clearest case in the room: there is
 * no such thing as a moulded cap with a knife edge, and 104 of them with knife
 * edges is 104 objects reflecting exactly one value each. The field is the
 * densest cluster of edges in the frame, so it is also where the chamfer buys
 * the most.
 *
 * 0.06 of a unit, and the instance scale turns that into the right physical
 * size rather than a uniform one: a 1u cap is 17.45 x 8 x 17.45 mm, so the cut
 * lands at 1.05 mm across the top and 0.48 mm down the side — both inside what
 * a real cap carries. Cost is 84 vertices against a box's 24, on a batch that
 * remains exactly one draw call.
 */
const KEYCAP_GEOMETRY = chamferedUnitBox(0.06, 'y');

/**
 * The keycaps, as one instanced draw call.
 *
 * 104 caps as individual meshes would be 104 draw calls for the smallest objects
 * in the room. Instanced, the whole field is one — fewer than the 59 the stunted
 * grid cost before, while carrying nearly twice the geometry. This is the same
 * pattern `Backdrop.tsx` uses for the rack LEDs and the ceiling rails, including
 * the `useLayoutEffect`: matrices have to be written before the demand renderer
 * draws its first frame, or the batch appears at the origin and then jumps.
 */
function Keycaps({ caps, material }: { caps: Cap[]; material: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);

  const colours = useMemo(() => {
    const plain = new THREE.Color('#1a1715');
    const worn = new THREE.Color('#39322b');
    return caps.map((cap) => (cap.accent ? worn : plain));
  }, [caps]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const identity = new THREE.Quaternion();
    caps.forEach((cap, index) => {
      matrix.compose(
        new THREE.Vector3(cap.x, 0, cap.z),
        identity,
        new THREE.Vector3(cap.width, 0.008, cap.depth),
      );
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, colours[index]!);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [caps, colours]);

  return (
    <instancedMesh
      ref={ref}
      args={[KEYCAP_GEOMETRY, material, caps.length]}
      count={caps.length}
      position={[0, PLATE.height + 0.004, 0]}
    />
  );
}

/**
 * A full-size keyboard, at full size.
 *
 * The pitch was corrected to 19.05 mm in the previous pass and is unchanged. What
 * changes here is the plate material and the extent of the key field — see
 * `buildKeyField`.
 *
 * The plate no longer carries the Poly Haven `metal_plate` scan. That set is a
 * photograph of painted sheet steel, and it was doing on the keyboard exactly
 * what the previous pass removed it from the monitor bezels for: lending a
 * gold-flecked photographic albedo to a shape that has none of the underlying
 * detail. What we model is a moulded plastic office board, so it is moulded
 * plastic now. `metal_plate` consequently has no consumer left in the scene —
 * recorded in `ASSET_LICENSES.md` rather than quietly dropped.
 *
 * Geometry only: the keyboard is not read by `projection.ts`, so the 2 px
 * monitor-drift budget cannot be affected.
 */
function Keyboard() {
  const materials = useMemo(() => {
    /*
     * The plate and the caps were one roughness number each. A moulded ABS
     * board has a fine mould texture on the case and a slightly different one
     * on the caps — the caps come out of a different tool and get handled — so
     * they get two maps rather than one shared one.
     *
     * Both scalars are divided by their map's mean, so the mean effective
     * roughness is still 0.78 and 0.72; only the variation is new. The plate is
     * a chamfered extrusion with UVs in metres, so `repeat: 40` is a 25 mm tile
     * on it. The caps are one instanced unit box, so every cap carries the same
     * patch of grain — which is what 104 caps out of one mould actually look
     * like.
     */
    const plateGrain = roughnessVariation({
      seed: 31,
      size: 128,
      cells: 10,
      amplitude: 0.18,
      repeat: 40,
    });
    const capGrain = roughnessVariation({ seed: 47, size: 128, cells: 6, amplitude: 0.12, repeat: 2 });
    const plateNormal = grainNormalMap({
      seed: 31,
      size: 128,
      cells: 10,
      amplitude: 1,
      strength: 0.0016,
      repeat: 40,
    });

    return {
      /* ABS case: matte, essentially dielectric. No metalness, no scan. */
      plate: new THREE.MeshStandardMaterial({
        color: '#211d1a',
        roughness: variedRoughness(0.78, plateGrain.mean),
        roughnessMap: plateGrain.texture,
        normalMap: plateNormal,
        normalScale: new THREE.Vector2(0.35, 0.35),
        metalness: 0.02,
        envMapIntensity: 0.12,
      }),
      /* Caps are white-based so `instanceColor` carries the real value. */
      keycap: new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: variedRoughness(0.72, capGrain.mean),
        roughnessMap: capGrain.texture,
      }),
      /* Num/Caps/Scroll. A real indicator, at a real indicator's brightness. */
      indicator: new THREE.MeshBasicMaterial({ color: '#8a6a2a', toneMapped: false }),
    };
  }, []);

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) {
        if ('roughnessMap' in material) material.roughnessMap?.dispose();
        if ('normalMap' in material) material.normalMap?.dispose();
        material.dispose();
      }
    },
    [materials],
  );

  const caps = useMemo(() => buildKeyField(), []);

  return (
    <group position={[0.02, SURFACE + 0.0015, DESK.z + 0.19]}>
      <mesh
        position={[0, PLATE.height / 2, 0]}
        material={materials.plate}
        geometry={sharedChamferedBox(PLATE.width, PLATE.height, PLATE.depth, 0.0012, 'y')}
        castShadow
        receiveShadow
      />
      <Keycaps caps={caps} material={materials.keycap} />
      {KEYBOARD_INDICATORS.map(([x, z], index) => (
        <mesh
          key={index}
          position={[x, PLATE.height + 0.0005, z]}
          material={materials.indicator}
        >
          <boxGeometry args={[0.0035, 0.001, 0.0025]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * The mouse, at the size of a mouse.
 *
 * It was a 76 mm hemisphere on a 76 mm puck: 76 x 76 x 52 mm, which is round in
 * plan and half as long as the object it is standing in for. A mouse is roughly
 * 62 mm across, 118 mm long and 40 mm high, and — like the keyboard's 19 mm
 * pitch — those are dimensions a viewer knows in their hand rather than has to
 * reason about. The old shape read as a dark dome, which is exactly the kind of
 * primitive-with-a-material that makes a scene look low-poly.
 *
 * The body is one sphere with a non-uniform scale, centred *below* the desk so
 * the desk crops it: the visible cap is 61 x 119 x 39 mm and its sides flare out
 * toward the base, which is the profile a mouse actually has and which a
 * hemisphere cannot make. Nothing below the mat is drawn — the mat writes depth
 * over it.
 *
 * The material stays matte on purpose. The realism here is the silhouette; a
 * glossier shell would put a specular highlight 0.5 m from the lens, and the
 * frame's brightest region outside the centre monitor is the statistic
 * `headlook.spec.ts` weighs the alarm against.
 */
function Mouse() {
  const materials = useMemo(
    () => ({
      shell: new THREE.MeshStandardMaterial({ color: '#221e1b', roughness: 0.62, metalness: 0.04 }),
      seam: new THREE.MeshStandardMaterial({ color: '#0b0a09', roughness: 0.9 }),
      wheel: new THREE.MeshStandardMaterial({ color: '#4a4139', roughness: 0.7 }),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  return (
    <group position={MOUSE_ORIGIN} rotation={[0, MOUSE_YAW, 0]}>
      {/* body: an ellipsoid sunk 16 mm into the desk, so the desk cuts its base */}
      <mesh
        position={[0, -0.016, 0.006]}
        scale={[0.032, 0.055, 0.062]}
        material={materials.shell}
        castShadow
      >
        <sphereGeometry args={[1, 22, 14]} />
      </mesh>
      {/*
        The button split and the wheel, at the far end.

        Both sat at +Z, which is the end nearest the chair — the mouse was
        modelled back to front, with its buttons under the heel of the hand and
        its cable leaving toward the player. The operator sits at +Z and the
        monitors are at -Z, so the buttons, the wheel and the cable all belong
        at -Z. The cable anchor in `workstationGeometry.ts` moved with them.
      */}
      <mesh
        position={[0, 0.024, -0.028]}
        rotation={[0.5, 0, 0]}
        material={materials.seam}
      >
        <boxGeometry args={[0.0018, 0.014, 0.05]} />
      </mesh>
      {/* scroll wheel, proud of the shell between the buttons */}
      <mesh position={[0, 0.031, -0.019]} rotation={[0, 0, Math.PI / 2]} material={materials.wheel}>
        <cylinderGeometry args={[0.0052, 0.0052, 0.0062, 12]} />
      </mesh>
    </group>
  );
}

/**
 * Fabric desk mat under the keyboard, so the hardware does not float.
 *
 * Widened for the staging pass. The reference's mat runs nearly the full width
 * of the picture and is the single largest shape in the foreground; ours was
 * small enough that the bottom third of the frame read as one flat plane of
 * desk veneer. A mat costs nothing and breaks that expanse in exactly the place
 * the composition needed breaking.
 */
function DeskMat() {
  const material = useMemo(() => {
    /*
     * Felt, as a weave rather than as a number.
     *
     * The mat is the largest single shape in the foreground and it was
     * `roughness: 0.99, metalness: 0` — one value across half a square metre in
     * the nearest band of the picture, which is exactly where a viewer's eye
     * checks whether a surface has a surface. It now carries both maps: a
     * roughness map for the value break-up and a shallow normal map for the
     * weave, at `repeat: 24` — a 42 mm tile on UVs that are in metres, so about
     * 5 mm of visible grain.
     *
     * This is the one surface where the mean effective roughness moves, and it
     * is worth being explicit about: 0.99 is already at the ceiling, so a map
     * that can only roughen has nothing left to do and the compensating divide
     * clamps at 1. What ships is a measured mean of 0.948 against 0.99. Between
     * those two values the GGX response is flat to several decimal places, and
     * the mat is the darkest surface in the room at `#17140f`; there is no
     * highlight there to gain or lose.
     */
    const weave = roughnessVariation({ seed: 7, size: 128, cells: 12, amplitude: 0.1, repeat: 24 });
    return new THREE.MeshStandardMaterial({
      color: '#17140f',
      roughness: variedRoughness(0.99, weave.mean),
      roughnessMap: weave.texture,
      normalMap: grainNormalMap({
        seed: 7,
        size: 256,
        cells: 12,
        amplitude: 1,
        strength: 0.0022,
        repeat: 24,
      }),
      normalScale: new THREE.Vector2(0.4, 0.4),
      metalness: 0,
    });
  }, []);

  useEffect(
    () => () => {
      material.roughnessMap?.dispose();
      material.normalMap?.dispose();
      material.dispose();
    },
    [material],
  );

  /*
   * A 2 mm slab, half sunk into the desk, rather than the plane it used to be.
   *
   * The mat is the longest single edge in the foreground, and a plane has no
   * edge at all: it met the desk with an infinitely thin seam that read as a
   * decal printed on the veneer. As a slab it stands 1 mm proud with a 0.6 mm
   * chamfer round the top, which is what a felt-backed mat does and what gives
   * the near band of the picture its one long highlight line.
   *
   * The top face stays at exactly `SURFACE + 0.001`, where the plane was. That
   * is deliberate: `Mouse` is an ellipsoid sunk below the desk and cropped by
   * whatever writes depth over it, and moving this surface would silently
   * change the height of the mouse.
   *
   * The desk itself is a scanned GLB and its own edge cannot be chamfered here;
   * that belongs to the Blender pass in §8, and is reported rather than faked
   * with a strip laid against a mesh nobody can inspect.
   */
  return (
    <mesh
      position={[0.04, SURFACE, DESK.z + 0.16]}
      material={material}
      geometry={sharedChamferedBox(1.56, 0.002, 0.56, 0.0006, 'y')}
      receiveShadow
    />
  );
}

/**
 * The near-foreground objects the reference has and Poly Haven does not
 * publish: a mug on its coaster, a stack of loose paper, three sticky notes
 * and a small hub. Boxes and cylinders, deliberately — they are 40 cm from the
 * lens, out of focus in every sense that matters, and their job is to occupy
 * the bottom band of the frame so the composition has a foreground layer at
 * all.
 */
function DeskClutter() {
  const materials = useMemo(
    () => ({
      /*
       * Desk dressing, desaturated toward the grey of its own luminance so the
       * mean-luminance floors cannot move. The reference's foreground is a grey
       * ceramic mug, a dark mat and a pale pad; ours was a set of amber props
       * sitting in an amber pool, and the foreground is a third of the frame.
       */
      ceramic: new THREE.MeshStandardMaterial({
        color: '#6c6761',
        roughness: 0.36,
        /* The mug wall is an open cylinder; without this you see through it. */
        side: THREE.DoubleSide,
      }),
      /* Kept matte and very dark: it is a small disc directly in the lamp pool. */
      coffee: new THREE.MeshStandardMaterial({ color: '#241a12', roughness: 0.55 }),
      cork: new THREE.MeshStandardMaterial({ color: '#605444', roughness: 0.9 }),
      paper: new THREE.MeshStandardMaterial({ color: '#89847c', roughness: 0.92 }),
      carton: new THREE.MeshStandardMaterial({ color: '#776e63', roughness: 0.95 }),
      /*
       * Down from `#cfae63`, then again from `#9d834b`. Three gold squares
       * sitting directly in the desk lamp's pool were the brightest pixels in
       * the whole seated frame — brighter than the alarm, which the contract
       * requires to be the first focal point. Measured then: the frame's top 1%
       * outside the centre monitor read 197 against the alarm's 164. They are
       * paper, and paper in a dim room is not gold.
       */
      sticky: new THREE.MeshStandardMaterial({ color: '#8f846b', roughness: 0.9 }),
      plastic: new THREE.MeshStandardMaterial({
        color: '#26221f',
        roughness: 0.5,
        metalness: 0.2,
      }),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  const y = SURFACE + 0.001;

  /*
   * Every position here is bounded by where the desk is actually in shot, and
   * that turned out to be a much smaller region than "the desk". Measured off
   * the seated camera: the bottom of the frame crosses the desk surface at
   * 0.77 m, which is z = 0.03 — so anything placed nearer than the front third
   * of the desk is below the picture entirely, and at that depth the frame is
   * only 1.7 m wide, so |x| must stay under about 0.85.
   *
   * The first cut of this set put a mug at (-0.46, 0.22). It was rendered, it
   * was lit, and no capture ever contained a pixel of it.
   */
  return (
    <group>
      {/*
        Mug and coaster, front left — the reference's nearest object.

        Two corrections. The wall is an open-ended cylinder, which with the
        default `FrontSide` meant the far inner wall was culled: looking down
        into the mug you saw through it to the desk. It is double-sided now, so
        the inside of a hollow object is actually there.

        And the mug has coffee in it. That is not decoration — an empty mug at
        this angle is a hole, and the flat dark disc is what tells the eye the
        cylinder has a bottom two thirds of the way up rather than at the desk.

        The coaster came down from 124 mm to 100 mm across, which is the size
        coasters are; the mug itself was already right at 86 x 90 mm.
      */}
      <group position={[-0.62, y, DESK.z + 0.1]}>
        <mesh material={materials.cork} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 0.006, 20]} />
        </mesh>
        <mesh position={[0, 0.048, 0]} material={materials.ceramic} castShadow>
          <cylinderGeometry args={[0.043, 0.038, 0.09, 22, 1, true]} />
        </mesh>
        <mesh position={[0, 0.006, 0]} material={materials.ceramic}>
          <cylinderGeometry args={[0.039, 0.038, 0.012, 22]} />
        </mesh>
        <mesh
          position={[0, 0.072, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={materials.coffee}
        >
          <circleGeometry args={[0.0405, 22]} />
        </mesh>
        {/*
          The handle, standing up.

          A torus is generated in the XY plane, so rotating it a quarter turn
          about X laid the loop flat on top of the desk — the handle was a ring
          you looked down into rather than one you could put a finger through.
          A handle's loop shares its plane with the mug's own axis, which is the
          torus's default orientation, so the correct rotation here is none.
        */}
        <mesh
          position={[0.05, 0.05, 0]}
          material={materials.ceramic}
          castShadow
        >
          <torusGeometry args={[0.024, 0.007, 8, 18]} />
        </mesh>
      </group>

      {/* loose paper and sticky notes, front right of the keyboard */}
      <mesh
        position={[0.82, y + 0.002, DESK.z + 0.06]}
        rotation={[-Math.PI / 2, 0, -0.14]}
        material={materials.paper}
      >
        <planeGeometry args={[0.21, 0.29]} />
      </mesh>
      {[
        [-0.86, DESK.z - 0.02, -0.2],
        [-0.8, DESK.z + 0.08, 0.12],
        [0.9, DESK.z - 0.04, 0.26],
      ].map(([x, z, spin], index) => (
        <mesh
          key={index}
          position={[x!, y + 0.001, z!]}
          rotation={[-Math.PI / 2, 0, spin!]}
          material={materials.sticky}
        >
          <planeGeometry args={[0.062, 0.062]} />
        </mesh>
      ))}

      {/* the hub every cable on this desk runs into */}
      <mesh position={HUB} rotation={[0, 0.2, 0]} material={materials.plastic} castShadow>
        <boxGeometry args={[0.11, 0.024, 0.07]} />
      </mesh>

      {/*
        Two archive boxes on the floor beside the desk.

        They are here for the rear head-look limit, which is the operator
        looking down past their right shoulder at floor and desk edge — the one
        view with almost nothing in it. `headlook.spec.ts` measures that view's
        structure by counting how many luminance bands hold at least 1% of the
        frame, and a corner containing only dark floor and dark desk scores
        three. Mid-value cardboard is a fourth band, and a stack of case files
        beside an incident desk is not set dressing invented for a metric.
      */}
      <group position={[1.24, 0, 0.14]} rotation={[0, -0.22, 0]}>
        <mesh position={[0, 0.13, 0]} material={materials.carton}>
          <boxGeometry args={[0.4, 0.26, 0.3]} />
        </mesh>
        <mesh position={[0.02, 0.34, 0.01]} rotation={[0, 0.16, 0]} material={materials.carton}>
          <boxGeometry args={[0.38, 0.16, 0.29]} />
        </mesh>
        <mesh position={[0.02, 0.425, 0.01]} rotation={[0, 0.16, 0]} material={materials.paper}>
          <boxGeometry args={[0.3, 0.01, 0.22]} />
        </mesh>
      </group>
    </group>
  );
}

/**
 * The cable runs, routed where the seated camera can actually see them.
 *
 * `docs/assets/office-concept-v2-neutral.png` is full of cable, and it is one of
 * the clearest things separating it from our frame — the reference's monitors are
 * plugged in and ours were not visibly connected to anything.
 *
 * They were not missing. They were routed out of shot. Every previous run passed
 * through `DESK.z - 0.44`, which is world z −0.56, and the shipped desk's back
 * edge is at −0.565 — so all three dropped over the back edge within 5 mm of
 * leaving the stand and spent the rest of their length behind an opaque desk, on
 * a floor the seated camera cannot see. Three tube meshes rendered every frame,
 * of which the frame contained almost nothing.
 *
 * So the routing changed rather than the idea. Each run now leaves the back of
 * its own neck (`monitorStand().cableAnchor`, so it starts where the neck really
 * is rather than at a copied literal), drops behind the base, comes out beside
 * it, and crosses the strip of desk *in front of* the bases — which is the band
 * the seated camera looks straight down at through the two gaps between the
 * three panels — before converging on the hub. The keyboard and the mouse have
 * leads for the same reason: they are the two objects nearest the lens.
 *
 * Two other numbers were wrong and are corrected here.
 *
 * The gauge was 15 mm across. A DisplayPort lead is about 6 mm and a peripheral
 * lead about 4 mm; at this distance 6 mm still subtends ~5 px, so the honest
 * size is also a visible one.
 *
 * And the jacket was `#131110`, which is within one value step of the desk mat
 * it crosses. PVC cable is a shade lighter than that and has a soft sheen rather
 * than none, so it now reads against both the mat and the desk instead of
 * disappearing into one of them.
 */
function Cables() {
  const materials = useMemo(
    () => ({
      /* Moulded PVC jacket: dark, but not the mat's own value, and slightly sheeny. */
      jacket: new THREE.MeshStandardMaterial({ color: '#1e1a17', roughness: 0.62 }),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  const runs = useMemo(() => cableRuns(), []);

  return (
    <group>
      {runs.map((run, index) => (
        <mesh key={index} material={materials.jacket}>
          <tubeGeometry args={[run.curve, 30, run.radius, 6, false]} />
        </mesh>
      ))}
    </group>
  );
}

