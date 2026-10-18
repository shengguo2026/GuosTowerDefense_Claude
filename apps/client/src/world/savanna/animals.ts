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
