import * as THREE from 'three';
import { ColorGeometryBuilder, transform } from '../geometryBuilder';

const FUR = 0xc8913f;
const FUR_DARK = 0x9a6a2c;
const MANE = 0x6b3f1a;

/** Calm resting lions; animals are scenery and are never harmed (spec §2). */
export function lionGeometry(male: boolean, lying: boolean): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  const y = lying ? 0.55 : 1.05;
  b.add(new THREE.IcosahedronGeometry(1, 1), FUR, transform(0, y, 0, [0, 0, 0], [1.35, 0.55, 0.6]));
  b.add(new THREE.IcosahedronGeometry(0.62, 1), FUR, transform(1, y + 0.12, 0, [0, 0, 0], [1, 1, 0.95]));
  b.add(
    new THREE.IcosahedronGeometry(0.4, 1),
    FUR,
    transform(1.65, y + 0.5, 0, [0, 0, 0], [1.15, 0.95, 0.9]),
  );
  b.add(new THREE.BoxGeometry(0.32, 0.24, 0.3), FUR_DARK, transform(2.02, y + 0.4, 0));
  for (const side of [-0.22, 0.22])
    b.add(new THREE.ConeGeometry(0.1, 0.16, 4), FUR_DARK, transform(1.55, y + 0.86, side));
  if (male)
    b.add(
      new THREE.IcosahedronGeometry(0.72, 1),
      MANE,
      transform(1.45, y + 0.48, 0, [0, 0, 0], [0.8, 1.05, 1.1]),
    );
  const legY = lying ? 0.18 : 0.45;
  const legH = lying ? 0.3 : 0.9;
  for (const [lx, lz] of [
    [0.9, 0.32],
    [0.9, -0.32],
    [-0.85, 0.32],
    [-0.85, -0.32],
  ] as const) {
    const front = lying && lx > 0;
    b.add(
      new THREE.CylinderGeometry(0.13, 0.11, legH, 5),
      FUR,
      transform(lx + (front ? 0.35 : 0), legY, lz, [0, 0, front ? Math.PI / 2 : 0]),
    );
  }
  b.add(new THREE.CylinderGeometry(0.05, 0.04, 1.3, 4), FUR, transform(-1.7, y - 0.1, 0, [0, 0, 1.2]));
  b.add(new THREE.IcosahedronGeometry(0.1, 0), MANE, transform(-2.25, y - 0.38, 0));
  return b.build();
}

const LEOPARD = 0xd9a44e;
const LEOPARD_BELLY = 0xead2a0;
const ROSETTE = 0x3a2a18;

/**
 * A resting leopard, long and low, with dark rosettes and a tail hanging over the rock edge. Scenery only, like every
 * animal in the game.
 */
export function leopardGeometry(lying: boolean): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  const y = lying ? 0.45 : 0.95;
  b.add(new THREE.IcosahedronGeometry(1, 1), LEOPARD, transform(0, y, 0, [0, 0, 0], [1.3, 0.42, 0.45]));
  b.add(
    new THREE.IcosahedronGeometry(0.7, 1),
    LEOPARD_BELLY,
    transform(0, y - 0.15, 0, [0, 0, 0], [1.6, 0.4, 0.55]),
  );
  b.add(
    new THREE.IcosahedronGeometry(0.36, 1),
    LEOPARD,
    transform(1.45, y + 0.25, 0, [0, 0, 0], [1.1, 0.9, 0.9]),
  );
  b.add(new THREE.BoxGeometry(0.24, 0.18, 0.24), LEOPARD_BELLY, transform(1.78, y + 0.18, 0));
  for (const side of [-0.18, 0.18])
    b.add(new THREE.ConeGeometry(0.08, 0.14, 4), LEOPARD, transform(1.4, y + 0.58, side));
  // Rosettes along the back and flanks.
  const spots: [number, number, number][] = [
    [-0.9, 0.28, 0.2],
    [-0.5, 0.36, -0.15],
    [-0.1, 0.38, 0.22],
    [0.3, 0.36, -0.2],
    [0.7, 0.3, 0.18],
    [-0.7, 0.18, 0.4],
    [0.1, 0.2, -0.42],
    [0.5, 0.15, 0.42],
    [-0.3, 0.12, -0.44],
  ];
  for (const [sx, sy, sz] of spots)
    b.add(
      new THREE.IcosahedronGeometry(0.09, 0),
      ROSETTE,
      transform(sx, y + sy, sz, [0, 0, 0], [1.3, 0.5, 1.3]),
    );
  const legY = lying ? 0.14 : 0.42;
  const legH = lying ? 0.26 : 0.85;
  for (const [lx, lz] of [
    [0.85, 0.25],
    [0.85, -0.25],
    [-0.85, 0.25],
    [-0.85, -0.25],
  ] as const) {
    const front = lying && lx > 0;
    b.add(
      new THREE.CylinderGeometry(0.1, 0.08, legH, 5),
      LEOPARD,
      transform(lx + (front ? 0.4 : 0), legY, lz, [0, 0, front ? Math.PI / 2 : 0]),
    );
  }
  // The long tail hangs down over the edge, its tip curled up.
  b.add(new THREE.CylinderGeometry(0.07, 0.05, 1.6, 5), LEOPARD, transform(-1.75, y - 0.45, 0, [0, 0, 0.35]));
  b.add(new THREE.IcosahedronGeometry(0.1, 0), ROSETTE, transform(-2.05, y - 1.2, 0));
  return b.build();
}

const HIDE = 0x8d8a86;
const HIDE_DARK = 0x77736f;
const TUSK = 0xf1ead8;

/**
 * A standing African elephant: a big rounded body, wide flat ears, a hanging trunk curling at the tip, and pillar legs.
 * A calf is the same shape, smaller and without tusks. Scenery only, like every animal in the game.
 */
export function elephantGeometry(calf: boolean): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  const legH = 1.5;
  const y = legH + 0.95;
  b.add(new THREE.IcosahedronGeometry(1, 1), HIDE, transform(0, y, 0, [0, 0, 0], [1.75, 1.15, 1.05]));
  // Head, slightly higher than the shoulders.
  b.add(new THREE.IcosahedronGeometry(0.8, 1), HIDE, transform(1.8, y + 0.45, 0, [0, 0, 0], [0.9, 1, 0.85]));
  // Ears: wide flat flaps either side of the head.
  for (const side of [-1, 1])
    b.add(
      new THREE.CylinderGeometry(0.95, 0.75, 0.12, 7),
      HIDE_DARK,
      transform(1.55, y + 0.45, side * 0.78, [Math.PI / 2, 0, 0.15], [1, 1, 1.25]),
    );
  // Trunk in three tapering pieces, the last one curling forward.
  b.add(new THREE.CylinderGeometry(0.26, 0.32, 1.1, 6), HIDE, transform(2.45, y - 0.15, 0, [0, 0, 0.35]));
  b.add(new THREE.CylinderGeometry(0.19, 0.25, 1, 6), HIDE, transform(2.62, y - 1.1, 0, [0, 0, -0.05]));
  b.add(
    new THREE.CylinderGeometry(0.14, 0.18, 0.55, 6),
    HIDE_DARK,
    transform(2.75, y - 1.75, 0, [0, 0, -0.6]),
  );
  if (!calf)
    for (const side of [-0.3, 0.3])
      b.add(new THREE.ConeGeometry(0.09, 0.85, 5), TUSK, transform(2.35, y - 0.45, side, [0, 0, -2.3]));
  for (const [lx, lz] of [
    [1.05, 0.5],
    [1.05, -0.5],
    [-1.05, 0.5],
    [-1.05, -0.5],
  ] as const)
    b.add(new THREE.CylinderGeometry(0.34, 0.38, legH + 0.4, 7), HIDE, transform(lx, legH / 2 + 0.1, lz));
  b.add(
    new THREE.CylinderGeometry(0.05, 0.04, 1.1, 4),
    HIDE_DARK,
    transform(-1.85, y - 0.3, 0, [0, 0, -0.35]),
  );
  const geometry = b.build();
  return calf ? geometry.scale(0.55, 0.55, 0.55) : geometry;
}
