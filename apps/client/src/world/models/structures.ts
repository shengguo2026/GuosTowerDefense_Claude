import * as THREE from 'three';
import { ColorGeometryBuilder, transform } from '../geometryBuilder';
import { SIDE_COLORS } from './people';

const WOOD = 0x7a5532;
const WOOD_DARK = 0x5a3c22;
const THATCH = 0xc9a560;

/** Ranger observation post: four legs, braces, a railed deck, ladder and thatched roof with a blue band. */
export function observationPostGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  const h = 5.2;
  for (const [x, z] of [
    [1.1, 1.1],
    [-1.1, 1.1],
    [1.1, -1.1],
    [-1.1, -1.1],
  ] as const) {
    b.add(new THREE.CylinderGeometry(0.13, 0.18, h, 6), WOOD, transform(x, h / 2, z));
  }
  for (const [x, z, ry] of [
    [0, 1.1, 0],
    [0, -1.1, 0],
    [1.1, 0, Math.PI / 2],
    [-1.1, 0, Math.PI / 2],
  ] as const) {
    b.add(new THREE.BoxGeometry(3.1, 0.1, 0.1), WOOD_DARK, transform(x, 2.2, z, [0, ry, 0.62]));
  }
  b.add(new THREE.BoxGeometry(3, 0.25, 3), WOOD, transform(0, h, 0));
  for (const [x, z, ry] of [
    [0, 1.45, 0],
    [0, -1.45, 0],
    [1.45, 0, Math.PI / 2],
  ] as const) {
    b.add(new THREE.BoxGeometry(2.9, 0.08, 0.08), WOOD_DARK, transform(x, h + 0.8, z, [0, ry, 0]));
  }
  for (const [x, z] of [
    [1.45, 1.45],
    [-1.45, 1.45],
    [1.45, -1.45],
    [-1.45, -1.45],
  ] as const) {
    b.add(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 4), WOOD_DARK, transform(x, h + 0.95, z));
  }
  b.add(new THREE.ConeGeometry(2.6, 1.5, 8), THATCH, transform(0, h + 2.6, 0));
  b.add(new THREE.CylinderGeometry(2.35, 2.45, 0.18, 8), SIDE_COLORS.defender, transform(0, h + 2.05, 0));
  for (let k = 0; k < 7; k++)
    b.add(
      new THREE.BoxGeometry(0.9, 0.06, 0.08),
      WOOD_DARK,
      transform(-1.5, 0.5 + k * 0.7, -0.6, [0, Math.PI / 2, 0]),
    );
  return b.build();
}

/** Temporary checkpoint: blue posts, a red-and-white barrier arm and sandbags. */
export function checkpointGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (const x of [-2, 2])
    b.add(new THREE.BoxGeometry(0.32, 1.4, 0.32), SIDE_COLORS.defender, transform(x, 0.7, 0));
  for (let k = 0; k < 6; k++)
    b.add(
      new THREE.BoxGeometry(0.7, 0.2, 0.2),
      k % 2 ? 0xffffff : 0xd23b3b,
      transform(-1.75 + k * 0.7, 1.2, 0),
    );
  for (let k = 0; k < 5; k++) {
    b.add(
      new THREE.CapsuleGeometry(0.2, 0.4, 2, 6),
      0xb59b6a,
      transform(-2.6 - (k % 2) * 0.1, 0.2 + Math.floor(k / 2) * 0.35, (k % 2) * 0.4 - 0.2, [
        0,
        0,
        Math.PI / 2,
      ]),
    );
  }
  return b.build();
}

/** Defense model by catalog id; unknown types get a simple marker post so nothing is ever invisible. */
export function defenseGeometry(defenseTypeId: string): THREE.BufferGeometry {
  if (defenseTypeId.includes('observation') || defenseTypeId.includes('light'))
    return observationPostGeometry();
  if (defenseTypeId.includes('checkpoint') || defenseTypeId.includes('gate')) return checkpointGeometry();
  return new ColorGeometryBuilder()
    .add(new THREE.CylinderGeometry(0.2, 0.25, 2.4, 6), SIDE_COLORS.defender, transform(0, 1.2, 0))
    .add(new THREE.OctahedronGeometry(0.45, 0), 0xffffff, transform(0, 2.7, 0))
    .build();
}
