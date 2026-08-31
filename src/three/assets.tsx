import { useEffect, useMemo } from 'react';
import { useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { TEXTURE_FILES } from './layout';

/**
 * Loading and placement for the CC0 office assets.
 *
 * Poly Haven models are real-world scale and Y-up, but their pivots are not
 * consistent — some sit on the origin, some are centred. Rather than hard-code
 * a magic offset per model, `<Prop>` measures the bounding box and places the
 * object by its *base and centre*, which is how a person describes furniture
 * ("the desk stands here") and survives an asset being swapped later.
 */

/* ------------------------------------------------------------------ *
 * Models
 * ------------------------------------------------------------------ */

export interface PropProps {
  url: string;
  /** Where the object's base centre goes. */
  position: [number, number, number];
  rotationY?: number;
  /** Scale so the widest horizontal dimension matches this, in metres. */
  targetWidth?: number;
  /** Scale so the height matches this, in metres. Takes precedence. */
  targetHeight?: number;
  /** Uniform multiplier applied after any target fit. */
  scale?: number;
  /** Environment reflection strength; lower for matte background dressing. */
  envMapIntensity?: number;
  /**
   * Multiplies the scanned albedo. Poly Haven captures are lit for daylight
   * product shots, so a pale metal desk reads as a white slab in a night
   * office. Tinting keeps the texture detail and the wear while bringing the
   * value into the room.
   */
  tint?: string;
  visible?: boolean;
  /**
   * Whether this prop drops a shadow, and whether one falls on it.
   *
   * Off by default and turned on per prop rather than globally. The room is a
   * shadow-mapped spot's worth of budget, not a full pass: everything on the
   * desk earns a contact shadow because the foreground is where the eye checks
   * whether objects are really sitting on a surface, and the background
   * dressing does not, because nothing there is close enough to anything for
   * the shadow to say something a viewer would notice.
   */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function Prop({
  url,
  position,
  rotationY = 0,
  targetWidth,
  targetHeight,
  scale = 1,
  envMapIntensity = 0.6,
  tint,
  visible = true,
  castShadow = false,
  receiveShadow = false,
}: PropProps) {
  const gltf = useLoader(GLTFLoader, url);

  const owned = useMemo<THREE.Material[]>(() => [], []);

  const object = useMemo(() => {
    // Clone so the same GLB can appear twice without sharing a transform.
    const root = gltf.scene.clone(true);

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());

    let fit = 1;
    if (targetHeight && size.y > 0) fit = targetHeight / size.y;
    else if (targetWidth) {
      const widest = Math.max(size.x, size.z);
      if (widest > 0) fit = targetWidth / widest;
    }
    const finalScale = fit * scale;

    // Re-centre on X/Z and drop the base to y = 0 before the caller's placement.
    const wrapper = new THREE.Group();
    root.position.set(-centre.x, -box.min.y, -centre.z);
    wrapper.add(root);
    wrapper.scale.setScalar(finalScale);

    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
      for (const entry of Array.isArray(material) ? material : [material]) {
        if (!entry) continue;
        if ('envMapIntensity' in entry) entry.envMapIntensity = envMapIntensity;
        if (tint && 'color' in entry) {
          // Clone first: materials are shared across clones of the same GLB.
          const tinted = entry.clone();
          tinted.color = new THREE.Color(tint);
          mesh.material = tinted;
          owned.push(tinted);
        }
      }
    });

    return wrapper;
  }, [gltf, targetWidth, targetHeight, scale, envMapIntensity, tint, owned, castShadow, receiveShadow]);

  // Tinted clones belong to this instance, so this instance frees them.
  useEffect(
    () => () => {
      for (const material of owned.splice(0)) material.dispose();
    },
    [owned],
  );

  return (
    <primitive object={object} position={position} rotation={[0, rotationY, 0]} visible={visible} />
  );
}

/* ------------------------------------------------------------------ *
 * Surface materials
 * ------------------------------------------------------------------ */

type SurfaceName = keyof typeof TEXTURE_FILES;

export interface SurfaceOverrides {
  color?: string;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number;
  repeat?: number;
}

/**
 * Builds a PBR material from a Poly Haven texture set.
 *
 * `arm` packs ambient occlusion, roughness and metalness into R/G/B, which is
 * exactly the layout three.js reads when the same image is assigned to
 * `aoMap`, `roughnessMap` and `metalnessMap`.
 */
export function useSurfaceMaterial(
  name: SurfaceName,
  overrides?: SurfaceOverrides,
): THREE.MeshStandardMaterial {
  const files = TEXTURE_FILES[name];
  const loaded = useLoader(THREE.TextureLoader, [files.map, files.normalMap, files.armMap]);
  const [map, normalMap, armMap] = loaded as [THREE.Texture, THREE.Texture, THREE.Texture];

  /*
   * Every call site passes an inline object literal, which is a new identity on
   * every render. Depending on that object directly would build — and orphan —
   * a fresh `MeshStandardMaterial` on each render of a component that re-renders
   * once a second. Depend on the primitives instead.
   */
  const { color, roughness, metalness, envMapIntensity, repeat } = overrides ?? {};
  const effectiveRepeat = repeat ?? files.repeat;

  const material = useMemo(() => {
    for (const texture of [map, normalMap, armMap]) {
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(effectiveRepeat, effectiveRepeat);
      texture.anisotropy = 4;
    }
    map.colorSpace = THREE.SRGBColorSpace;

    return new THREE.MeshStandardMaterial({
      map,
      normalMap,
      aoMap: armMap,
      roughnessMap: armMap,
      metalnessMap: armMap,
      metalness: metalness ?? 1,
      roughness: roughness ?? 1,
      envMapIntensity: envMapIntensity ?? 0.5,
      ...(color ? { color: new THREE.Color(color) } : {}),
    });
  }, [map, normalMap, armMap, effectiveRepeat, color, roughness, metalness, envMapIntensity]);

  useEffect(() => () => material.dispose(), [material]);

  return material;
}

/* ------------------------------------------------------------------ *
 * Environment
 * ------------------------------------------------------------------ */

/**
 * A warm two-stop environment, generated rather than downloaded.
 *
 * PBR materials look plastic without an environment to reflect. A Poly Haven
 * HDRI would cost ~1.5 MB and most interior captures inject cool daylight —
 * straight into the colour gate this pass has to pass. Sixteen pixels of warm
 * gradient through `PMREMGenerator` gives the same lift with neither problem.
 */
export function WarmEnvironment({ intensity = 1 }: { intensity?: number }) {
  const scene = useThree((state) => state.scene);
  const renderer = useThree((state) => state.gl);

  useEffect(() => {
    const width = 32;
    const height = 16;
    const data = new Uint8Array(width * height * 4);

    const top = new THREE.Color('#3a2f26'); // warm ceiling bounce
    const bottom = new THREE.Color('#0a0806'); // dark floor
    const colour = new THREE.Color();

    for (let y = 0; y < height; y += 1) {
      // Smooth vertical ramp; no horizontal variation, so nothing directional.
      const t = y / (height - 1);
      colour.copy(bottom).lerp(top, 1 - t).multiplyScalar(intensity);
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        data[index] = Math.round(Math.min(1, colour.r) * 255);
        data[index + 1] = Math.round(Math.min(1, colour.g) * 255);
        data[index + 2] = Math.round(Math.min(1, colour.b) * 255);
        data[index + 3] = 255;
      }
    }

    const source = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
    source.mapping = THREE.EquirectangularReflectionMapping;
    source.colorSpace = THREE.SRGBColorSpace;
    source.needsUpdate = true;

    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromEquirectangular(source);
    scene.environment = target.texture;

    return () => {
      scene.environment = null;
      target.dispose();
      pmrem.dispose();
      source.dispose();
    };
  }, [scene, renderer, intensity]);

  return null;
}
