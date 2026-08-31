#!/usr/bin/env node
/*
 * Reports the real-world size of every shipped model, and of the props the room
 * places, after the fit `<Prop>` applies.
 *
 * `src/three/layout.ts` used to carry a `DESK` of 2.34 x 0.78 m. Nothing read
 * those numbers, so nothing failed — but the monitor stands were positioned
 * against the back edge they implied, and the shipped desk is 1.88 x 0.89 m, so
 * 71% of the centre monitor's base was cantilevered off the back of a desk that
 * ended 9 cm earlier than the constant said. A wrong number that nothing checks
 * is still a wrong number; this is the check.
 *
 *   node scripts/measure-models.mjs               # every shipped model
 *   node scripts/measure-models.mjs a.glb b.glb   # named files
 *
 * Like `measure-cast.mjs`, this is a review instrument and not a gate. It does
 * not fail a build. It exists so that "is the desk the size we say it is" is a
 * question with an answer rather than an opinion.
 *
 * The arithmetic: Poly Haven's glb exports use `KHR_mesh_quantization`, so
 * POSITION is normalised int16 — the accessor's own min/max are the quantised
 * values, dequantised by dividing by 32767 and then transformed by the node
 * hierarchy. Reading the accessor bounds rather than the vertex data makes this
 * exact and effectively free.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MODEL_DIR = 'public/models';

/** glTF chunk types, little-endian, as they appear in the GLB header. */
const CHUNK_JSON = 0x4e4f534a;

/** Dequantisation divisor for a `normalized: true` SHORT accessor. */
const SHORT_SCALE = 32767;

function readJsonChunk(file) {
  const buf = readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 12; // past magic, version and total length
  while (offset < buf.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) return JSON.parse(buf.subarray(start, start + length).toString('utf8'));
    offset = start + length + ((4 - (length % 4)) % 4);
  }
  throw new Error(`${file}: no JSON chunk`);
}

function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** A node's local matrix, from either `matrix` or the TRS triple. */
function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx;
  const y2 = qy + qy;
  const z2 = qz + qz;
  const xx = qx * x2;
  const xy = qx * y2;
  const xz = qx * z2;
  const yy = qy * y2;
  const yz = qy * z2;
  const zz = qz * z2;
  const wx = qw * x2;
  const wy = qw * y2;
  const wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transform(matrix, point) {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

/** World-space axis-aligned size of one .glb, in metres. */
export function measureModel(file) {
  const gltf = readJsonChunk(file);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  const walk = (index, parent) => {
    const node = gltf.nodes[index];
    const world = multiply(parent, localMatrix(node));

    if (node.mesh !== undefined) {
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        if (!accessor || !accessor.min) continue;
        const divisor = accessor.normalized ? SHORT_SCALE : 1;
        // Eight corners, because a rotated node turns the box into a new box.
        for (let corner = 0; corner < 8; corner += 1) {
          const local = [
            (corner & 1 ? accessor.max[0] : accessor.min[0]) / divisor,
            (corner & 2 ? accessor.max[1] : accessor.min[1]) / divisor,
            (corner & 4 ? accessor.max[2] : accessor.min[2]) / divisor,
          ];
          const world3 = transform(world, local);
          for (let axis = 0; axis < 3; axis += 1) {
            if (world3[axis] < min[axis]) min[axis] = world3[axis];
            if (world3[axis] > max[axis]) max[axis] = world3[axis];
          }
        }
      }
    }

    for (const child of node.children ?? []) walk(child, world);
  };

  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) walk(root, identity);

  return { min, max, size: max.map((value, axis) => value - min[axis]) };
}

/**
 * What the room asks for, so the printed size is the size on screen rather than
 * the size in the file. Mirrors the `<Prop>` calls in `src/three`.
 */
const FITS = {
  'metal_office_desk.glb': { targetHeight: 0.74 },
  'modern_arm_chair_01.glb': { targetHeight: 0.96 },
  'desk_lamp_arm_01.glb': { targetHeight: 0.4 },
  'drawer_cabinet.glb': { targetHeight: 0.86 },
  'worn_metal_rack.glb': { targetHeight: 1.72 },
  'potted_plant_01.glb': { targetHeight: 0.42 },
  'metal_trash_can.glb': { targetHeight: 0.42 },
  'plastic_thermos.glb': { targetHeight: 0.17 },
  'office_notepads.glb': { targetWidth: 0.2 },
  'stationery_supplies.glb': { targetWidth: 0.2 },
  'colleague_suit_female.glb': { targetHeight: 1.7 },
};

/** The same fit `<Prop>` performs: height wins, then widest horizontal. */
function fitScale(size, fit) {
  if (!fit) return 1;
  if (fit.targetHeight && size[1] > 0) return fit.targetHeight / size[1];
  if (fit.targetWidth) {
    const widest = Math.max(size[0], size[2]);
    if (widest > 0) return fit.targetWidth / widest;
  }
  return 1;
}

const named = process.argv.slice(2);
const files = named.length
  ? named
  : existsSync(MODEL_DIR)
    ? readdirSync(MODEL_DIR)
        .filter((entry) => entry.endsWith('.glb'))
        .sort()
        .map((entry) => join(MODEL_DIR, entry))
    : [];

if (files.length === 0) {
  console.log(`no models found in ${MODEL_DIR}`);
} else {
  console.log('name                            native (m)                as placed (m)');
  for (const file of files) {
    const name = file.split('/').pop();
    const { size } = measureModel(file);
    const scale = fitScale(size, FITS[name]);
    const placed = size.map((value) => value * scale);
    const show = (dims) => dims.map((value) => value.toFixed(3).padStart(6)).join(' x ');
    console.log(`${name.padEnd(31)} ${show(size)}    ${show(placed)}`);
  }
  console.log('');
  console.log('Order is x (width) x y (height) x z (depth), in metres.');
}
