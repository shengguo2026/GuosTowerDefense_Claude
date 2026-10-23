import type { Rng } from '@gtd/sim';
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ColorGeometryBuilder, transform } from '../geometryBuilder';

/** Savanna palette, taken from the approved low-poly sample. */
export const SAVANNA = {
  bark: 0x5a3d26,
  leafA: 0x6f8a3a,
  leafB: 0x86a046,
  leafUnder: 0x4c6128,
  bush: [0x6b7d35, 0x7f8f3c, 0x5c6e2e],
  rock: [0xa8977f, 0x968671, 0xb8a88f],
  mound: 0xb07848,
  moundDark: 0xa86f40,
  reed: 0x8a9a4a,
  pebble: 0x8f7f6a,
  mud: 0x7d5f3e,
};

/** Woodland palette for levels like Leopard: deeper greens and grey granite. */
export const WOODLAND = {
  bark: 0x4e3622,
  leaf: [0x4f6b2c, 0x5d7a31, 0x6a8a38, 0x47612a],
  thicket: [0x4a6328, 0x587330, 0x3f5524],
  granite: [0x9a958c, 0x8a857c, 0xaaa59a, 0x7f7a72],
};

/** Broad-leaf woodland tree (marula, mopane): a straight trunk under a rounded, clumped crown. */
export function broadleaf(rng: Rng, scale: number): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  const height = rng.range(3.4, 5) * scale;
  b.add(
    new THREE.CylinderGeometry(0.2 * scale, 0.36 * scale, height, 6),
    WOODLAND.bark,
    transform(0, height / 2, 0, [rng.range(-0.08, 0.08), 0, rng.range(-0.08, 0.08)]),
  );
  const clumps = rng.int(4, 7);
  for (let k = 0; k < clumps; k++) {
    const angle = (k / clumps) * Math.PI * 2 + rng.range(0, 0.8);
    const out = rng.range(0.6, 1.6) * scale;
    b.add(
      new THREE.IcosahedronGeometry(rng.range(1.2, 1.9) * scale, 0),
      rng.pick(WOODLAND.leaf),
      transform(
        Math.cos(angle) * out,
        height + rng.range(-0.3, 0.9) * scale,
        Math.sin(angle) * out,
        [0, rng.range(0, 6), 0],
        [1, rng.range(0.7, 0.95), 1],
      ),
    );
  }
  b.add(
    new THREE.IcosahedronGeometry(1.8 * scale, 0),
    rng.pick(WOODLAND.leaf),
    transform(0, height + 1.1 * scale, 0, [0, rng.range(0, 6), 0], [1, 0.8, 1]),
  );
  return b.build();
}

/** Dense thicket bush: taller and darker than a savanna bush; it hides whoever walks through it. */
export function thicket(rng: Rng): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (let k = 0; k < 6; k++) {
    b.add(
      new THREE.IcosahedronGeometry(rng.range(0.6, 1.1), 0),
      WOODLAND.thicket[k % 3] as number,
      transform(
        rng.range(-1, 1),
        rng.range(0.4, 1.3),
        rng.range(-1, 1),
        [0, rng.range(0, 6), 0],
        [1, 0.9, 1],
      ),
    );
  }
  return b.build();
}

/** Rounded granite boulder, grey instead of the savanna's sandy rock. */
export function granite(rng: Rng, size: number, flat = 0.75): THREE.BufferGeometry {
  let shape: THREE.BufferGeometry = new THREE.DodecahedronGeometry(size, 1);
  shape.deleteAttribute('normal');
  shape.deleteAttribute('uv');
  shape = mergeVertices(shape);
  const p = shape.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      p.getX(i) * rng.range(0.9, 1.15),
      p.getY(i) * rng.range(flat * 0.85, flat),
      p.getZ(i) * rng.range(0.9, 1.15),
    );
  }
  shape.computeVertexNormals();
  return new ColorGeometryBuilder()
    .add(shape, rng.pick(WOODLAND.granite), transform(0, size * flat * 0.45, 0, [0, rng.range(0, 6), 0]))
    .build();
}

/** Umbrella acacia: forked trunk and a layered flat canopy. */
export function acacia(rng: Rng, scale: number): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  const height = rng.range(3, 4) * scale;
  b.add(
    new THREE.CylinderGeometry(0.22 * scale, 0.38 * scale, height * 0.55, 6),
    SAVANNA.bark,
    transform(0, height * 0.27, 0),
  );
  let crown = 0;
  for (let k = 0; k < 3; k++) {
    const angle = (k / 3) * Math.PI * 2 + rng.range(0, 1);
    const length = height * 0.6;
    const tilt = rng.range(0.45, 0.75);
    const tipY = height * 0.55 + Math.cos(tilt) * length;
    crown = Math.max(crown, tipY);
    b.add(
      new THREE.CylinderGeometry(0.1 * scale, 0.2 * scale, length, 5),
      SAVANNA.bark,
      transform(
        (Math.sin(angle) * Math.sin(tilt) * length) / 2,
        height * 0.55 + (Math.cos(tilt) * length) / 2,
        (Math.cos(angle) * Math.sin(tilt) * length) / 2,
        [Math.cos(angle) * tilt, 0, -Math.sin(angle) * tilt],
      ),
    );
  }
  b.add(
    new THREE.IcosahedronGeometry(2.8 * scale, 1),
    SAVANNA.leafUnder,
    transform(0, crown - 0.1, 0, [0, 0, 0], [1.45, 0.18, 1.3]),
  );
  for (let k = 0; k < 5; k++) {
    b.add(
      new THREE.IcosahedronGeometry(rng.range(1.2, 1.8) * scale, 0),
      rng.next() < 0.5 ? SAVANNA.leafA : SAVANNA.leafB,
      transform(
        rng.range(-1.8, 1.8) * scale,
        crown + rng.range(0.1, 0.45) * scale,
        rng.range(-1.6, 1.6) * scale,
        [0, rng.range(0, 6), 0],
        [1.5, 0.32, 1.4],
      ),
    );
  }
  return b.build();
}

export function bush(rng: Rng): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (let k = 0; k < 4; k++) {
    b.add(
      new THREE.IcosahedronGeometry(rng.range(0.5, 0.9), 0),
      SAVANNA.bush[k % 3] as number,
      transform(rng.range(-0.7, 0.7), rng.range(0.3, 0.6), rng.range(-0.7, 0.7), [0, 0, 0], [1, 0.75, 1]),
    );
  }
  return b.build();
}

/** Weathered boulder: a dodecahedron squashed and dented per vertex. */
export function rock(rng: Rng, size: number): THREE.BufferGeometry {
  let shape: THREE.BufferGeometry = new THREE.DodecahedronGeometry(size, 1);
  shape.deleteAttribute('normal');
  shape.deleteAttribute('uv');
  shape = mergeVertices(shape);
  const p = shape.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(
      i,
      p.getX(i) * rng.range(0.85, 1.15),
      p.getY(i) * rng.range(0.55, 0.75),
      p.getZ(i) * rng.range(0.85, 1.15),
    );
  }
  shape.computeVertexNormals();
  const b = new ColorGeometryBuilder();
  b.add(shape, rng.pick(SAVANNA.rock), transform(0, size * 0.25, 0, [0, rng.range(0, 6), 0]));
  return b.build();
}

export function termiteMound(): THREE.BufferGeometry {
  return new ColorGeometryBuilder()
    .add(new THREE.ConeGeometry(0.9, 2.6, 6), SAVANNA.mound, transform(0, 1.2, 0))
    .add(new THREE.ConeGeometry(0.45, 1.4, 5), SAVANNA.moundDark, transform(0.6, 0.6, 0.2))
    .build();
}

export function reed(rng: Rng): THREE.BufferGeometry {
  const height = rng.range(1.2, 2.2);
  return new ColorGeometryBuilder()
    .add(
      new THREE.ConeGeometry(0.08, height, 3),
      SAVANNA.reed,
      transform(0, height / 2, 0, [rng.range(-0.2, 0.2), 0, rng.range(-0.2, 0.2)]),
    )
    .build();
}

/** Three crossed blades; instanced thousands of times with per-instance colour. */
export function grassTuftGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.ConeGeometry(0.07, 0.9, 3);
    blade.translate(0, 0.45, 0);
    blade.rotateZ((k - 1) * 0.35);
    blade.rotateY(k * 2.1);
    blades.push(blade.toNonIndexed());
  }
  const positions: number[] = [];
  for (const blade of blades) positions.push(...(blade.attributes.position as THREE.BufferAttribute).array);
  const tuft = new THREE.BufferGeometry();
  tuft.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  tuft.computeVertexNormals();
  return tuft;
}
