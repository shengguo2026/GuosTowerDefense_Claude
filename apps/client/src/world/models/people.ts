import * as THREE from 'three';
import { ColorGeometryBuilder, transform } from '../geometryBuilder';

export const SIDE_COLORS = { attacker: 0xe8742c, defender: 0x2e6fe0 } as const;

const SKIN = 0xc58c64;
const BOOTS = 0x3b2a1d;
const BELT = 0x3a2a1a;

export interface PersonLook {
  cloth: number;
  accent: number;
  hat: number;
  backpack: boolean;
}

export const LOOKS = {
  /** Expedition members: khaki with orange scarf and pack. */
  explorer: { cloth: 0xcbb48a, accent: SIDE_COLORS.attacker, hat: 0xe9dcb8, backpack: true },
  /** Scouts travel light. */
  scout: { cloth: 0xd8c39a, accent: SIDE_COLORS.attacker, hat: 0xc9a46a, backpack: false },
  /** Rangers: olive uniform with blue scarf. */
  ranger: { cloth: 0x5d6b3a, accent: SIDE_COLORS.defender, hat: 0x4a5530, backpack: false },
  /** Guides: light shirts and wide hats. */
  guide: { cloth: 0xe6d7b4, accent: SIDE_COLORS.attacker, hat: 0x8a6a3e, backpack: false },
  /** Trackers: dusty brown, travel light. */
  tracker: { cloth: 0x9a7b52, accent: SIDE_COLORS.attacker, hat: 0x6e5534, backpack: false },
  /** Hunters: dark olive with an orange vest band and a heavy pack. */
  hunter: { cloth: 0x4f5238, accent: SIDE_COLORS.attacker, hat: 0x3d3f2a, backpack: true },
  /** Photographers: grey vests and camera bags. */
  photographer: { cloth: 0x8d8f86, accent: SIDE_COLORS.attacker, hat: 0x5f615a, backpack: true },
} satisfies Record<string, PersonLook>;

export type LookName = keyof typeof LOOKS;

/** A small figure facing +z, feet at y = 0; one geometry so it can be instanced. */
export function personGeometry(look: PersonLook): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (const sx of [-0.13, 0.13]) {
    b.add(new THREE.CylinderGeometry(0.09, 0.08, 0.7, 5), look.cloth, transform(sx, 0.42, 0));
    b.add(new THREE.BoxGeometry(0.16, 0.12, 0.26), BOOTS, transform(sx, 0.06, 0.04));
  }
  b.add(new THREE.CylinderGeometry(0.24, 0.2, 0.62, 6), look.cloth, transform(0, 1.08, 0));
  b.add(new THREE.CylinderGeometry(0.21, 0.21, 0.08, 6), BELT, transform(0, 0.8, 0));
  b.add(new THREE.TorusGeometry(0.17, 0.06, 4, 8), look.accent, transform(0, 1.38, 0, [Math.PI / 2, 0, 0]));
  for (const side of [-1, 1]) {
    b.add(
      new THREE.CylinderGeometry(0.07, 0.06, 0.6, 5),
      look.cloth,
      transform(side * 0.31, 1.05, 0, [0, 0, side * 0.18]),
    );
  }
  b.add(new THREE.IcosahedronGeometry(0.17, 1), SKIN, transform(0, 1.6, 0));
  b.add(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 10), look.hat, transform(0, 1.72, 0));
  b.add(new THREE.CylinderGeometry(0.16, 0.19, 0.16, 8), look.hat, transform(0, 1.8, 0));
  if (look.backpack) {
    b.add(new THREE.BoxGeometry(0.36, 0.46, 0.2), look.accent, transform(0, 1.1, -0.24));
    b.add(
      new THREE.CylinderGeometry(0.08, 0.08, 0.38, 6),
      0x6b5a3a,
      transform(0, 1.38, -0.24, [0, 0, Math.PI / 2]),
    );
  }
  return b.build();
}
