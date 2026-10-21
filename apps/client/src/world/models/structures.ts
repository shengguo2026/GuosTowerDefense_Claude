import * as THREE from 'three';
import { ColorGeometryBuilder, transform } from '../geometryBuilder';
import { LOOKS, SIDE_COLORS, personGeometry } from './people';

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

/** A ranger patrol: three rangers walking together around a small flag. */
function patrolGeometry(): THREE.BufferGeometry {
  const person = personGeometry(LOOKS.ranger);
  const b = new ColorGeometryBuilder();
  for (const [x, z] of [
    [0, 0.5],
    [-0.55, -0.35],
    [0.55, -0.35],
  ] as const)
    b.addColored(person, transform(x, 0, z));
  b.add(new THREE.CylinderGeometry(0.03, 0.03, 2, 4), 0x6b5a45, transform(0, 1, -0.1));
  b.add(new THREE.BoxGeometry(0.02, 0.35, 0.55), SIDE_COLORS.defender, transform(0, 1.8, 0.18));
  person.dispose();
  return b.build();
}

/** An open off-road vehicle in a side colour: body, cabin frame, spare wheel and four wheels. Faces +z. */
export function vehicleGeometry(color: number): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  b.add(new THREE.BoxGeometry(1.7, 0.7, 3.4), color, transform(0, 0.75, 0));
  b.add(new THREE.BoxGeometry(1.6, 0.5, 1.2), 0x30363d, transform(0, 1.3, 0.25));
  for (const x of [-0.75, 0.75])
    b.add(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 4), 0x30363d, transform(x, 1.6, -0.3));
  b.add(new THREE.BoxGeometry(1.6, 0.06, 1.4), 0xd9cfb8, transform(0, 2.05, -0.1));
  for (const [x, z] of [
    [-0.85, 1.1],
    [0.85, 1.1],
    [-0.85, -1.1],
    [0.85, -1.1],
  ] as const)
    b.add(
      new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10),
      0x22262b,
      transform(x, 0.38, z, [0, 0, Math.PI / 2]),
    );
  b.add(
    new THREE.CylinderGeometry(0.34, 0.34, 0.22, 10),
    0x22262b,
    transform(0, 0.9, -1.8, [Math.PI / 2, 0, 0]),
  );
  return b.build();
}

/** A barrier: posts and a striped bar, light (a rope line) or heavy (concrete blocks in front). */
function barrierGeometry(heavy: boolean): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (const x of [-2, 0, 2])
    b.add(new THREE.CylinderGeometry(0.1, 0.12, 1.1, 6), WOOD, transform(x, 0.55, 0));
  for (let k = 0; k < 8; k++)
    b.add(
      new THREE.BoxGeometry(0.5, 0.1, 0.1),
      k % 2 ? 0xffffff : SIDE_COLORS.defender,
      transform(-1.75 + k * 0.5, 0.95, 0),
    );
  if (heavy)
    for (const x of [-1.6, 0, 1.6])
      b.add(new THREE.BoxGeometry(1.4, 0.7, 0.6), 0xb8b2a6, transform(x, 0.35, 0.6));
  return b.build();
}

/** A temporary fence: a line of thin posts with two rails. */
function fenceGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (let k = 0; k < 6; k++) b.add(new THREE.BoxGeometry(0.1, 1.2, 0.1), WOOD, transform(-2.5 + k, 0.6, 0));
  for (const y of [0.45, 0.95]) b.add(new THREE.BoxGeometry(5.2, 0.08, 0.06), WOOD_DARK, transform(0, y, 0));
  return b.build();
}

/** A pole with a lamp head: beacons, sensors and markers (sensors carry a dish, markers a flag). */
function poleGeometry(kind: 'beacon' | 'sensor' | 'marker'): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  b.add(new THREE.CylinderGeometry(0.08, 0.12, 2.6, 6), 0x5b636b, transform(0, 1.3, 0));
  b.add(new THREE.CylinderGeometry(0.4, 0.5, 0.25, 8), 0x5b636b, transform(0, 0.12, 0));
  if (kind === 'beacon') b.add(new THREE.SphereGeometry(0.28, 8, 6), 0xffd447, transform(0, 2.75, 0));
  if (kind === 'sensor') {
    b.add(
      new THREE.ConeGeometry(0.45, 0.3, 10, 1, true),
      0xe8eef2,
      transform(0, 2.7, 0.15, [Math.PI / 2.4, 0, 0]),
    );
    b.add(new THREE.BoxGeometry(0.3, 0.3, 0.3), SIDE_COLORS.defender, transform(0, 2.45, 0));
  }
  if (kind === 'marker') b.add(new THREE.BoxGeometry(0.03, 0.5, 0.8), 0x3fae6a, transform(0, 2.3, 0.4));
  return b.build();
}

/** A small hut with a roof: conservation posts and observation stations (stations carry an antenna). */
function hutGeometry(antenna: boolean): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  b.add(new THREE.BoxGeometry(2.6, 1.8, 2.2), 0xd8c9a6, transform(0, 0.9, 0));
  b.add(new THREE.ConeGeometry(2.2, 1.1, 4), THATCH, transform(0, 2.35, 0, [0, Math.PI / 4, 0]));
  b.add(new THREE.BoxGeometry(0.7, 1.1, 0.05), WOOD_DARK, transform(0, 0.55, 1.12));
  b.add(new THREE.BoxGeometry(2.62, 0.18, 2.22), SIDE_COLORS.defender, transform(0, 1.6, 0));
  if (antenna) b.add(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), 0x5b636b, transform(0.8, 3.2, 0.5));
  return b.build();
}

/** A low wooden observation platform with railings. */
function platformGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (const [x, z] of [
    [1.2, 1.2],
    [-1.2, 1.2],
    [1.2, -1.2],
    [-1.2, -1.2],
  ] as const)
    b.add(new THREE.CylinderGeometry(0.12, 0.14, 2.2, 6), WOOD, transform(x, 1.1, z));
  b.add(new THREE.BoxGeometry(3, 0.2, 3), WOOD, transform(0, 2.2, 0));
  for (const z of [-1.45, 1.45])
    b.add(new THREE.BoxGeometry(2.9, 0.08, 0.08), WOOD_DARK, transform(0, 2.9, z));
  b.add(new THREE.BoxGeometry(3, 0.12, 0.2), SIDE_COLORS.defender, transform(0, 2.35, 1.5));
  return b.build();
}

/** A slow field: a mat of low blue flags staked into the ground around a route node. */
function slowFieldGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.cos(a) * 2.2;
    const z = Math.sin(a) * 2.2;
    b.add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 4), WOOD_DARK, transform(x, 0.4, z));
    b.add(new THREE.BoxGeometry(0.02, 0.22, 0.35), SIDE_COLORS.defender, transform(x, 0.7, z + 0.17));
  }
  b.add(new THREE.CylinderGeometry(2.3, 2.3, 0.04, 16), 0x9ab7e8, transform(0, 0.03, 0));
  return b.build();
}

/** A protection tower: taller than the observation post, stone base and a blue roof. */
function towerGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  b.add(new THREE.CylinderGeometry(1.4, 1.7, 1.2, 8), 0xa79f90, transform(0, 0.6, 0));
  b.add(new THREE.CylinderGeometry(0.9, 1.1, 5, 8), 0xd8c9a6, transform(0, 3.6, 0));
  b.add(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 8), WOOD, transform(0, 6.2, 0));
  b.add(new THREE.ConeGeometry(1.8, 1.4, 8), SIDE_COLORS.defender, transform(0, 7.1, 0));
  return b.build();
}

/** A survey drone: four rotors around a small body (drawn hovering above its post). */
function droneGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  b.add(new THREE.BoxGeometry(0.6, 0.2, 0.6), 0xe8eef2, transform(0, 4, 0));
  for (const [x, z] of [
    [0.6, 0.6],
    [-0.6, 0.6],
    [0.6, -0.6],
    [-0.6, -0.6],
  ] as const) {
    b.add(
      new THREE.BoxGeometry(0.85, 0.05, 0.08),
      0x30363d,
      transform(x / 2, 4, z / 2, [0, Math.atan2(x, z), 0]),
    );
    b.add(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 10), SIDE_COLORS.defender, transform(x, 4.08, z));
  }
  b.add(new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4), 0x30363d, transform(0, 0.25, 0));
  return b.build();
}

/** A maintenance crew: two rangers with a toolbox. */
function crewGeometry(): THREE.BufferGeometry {
  const person = personGeometry(LOOKS.ranger);
  const b = new ColorGeometryBuilder();
  b.addColored(person, transform(-0.4, 0, 0));
  b.addColored(person, transform(0.45, 0, 0.2));
  b.add(new THREE.BoxGeometry(0.5, 0.3, 0.3), 0xd68a1c, transform(0, 0.15, 0.7));
  person.dispose();
  return b.build();
}

/**
 * Defense model by the catalog's `model` (or, for stage packs without one, by id); unknown kinds get a simple marker
 * post so nothing is ever invisible.
 */
export function defenseGeometry(defenseTypeId: string, model?: string): THREE.BufferGeometry {
  switch (model) {
    case 'observationPost':
      return observationPostGeometry();
    case 'checkpoint':
      return checkpointGeometry();
    case 'patrol':
      return patrolGeometry();
    case 'vehicle':
      return vehicleGeometry(SIDE_COLORS.defender);
    case 'tower':
      return towerGeometry();
    case 'lightBarrier':
      return barrierGeometry(false);
    case 'heavyBarrier':
      return barrierGeometry(true);
    case 'fence':
      return fenceGeometry();
    case 'beacon':
    case 'sensor':
    case 'marker':
      return poleGeometry(model);
    case 'conservationPost':
      return hutGeometry(false);
    case 'station':
      return hutGeometry(true);
    case 'platform':
      return platformGeometry();
    case 'slowField':
      return slowFieldGeometry();
    case 'drone':
      return droneGeometry();
    case 'crew':
      return crewGeometry();
    default:
      break;
  }
  if (defenseTypeId.includes('patrol')) return patrolGeometry();
  if (defenseTypeId.includes('observation') || defenseTypeId.includes('light'))
    return observationPostGeometry();
  if (defenseTypeId.includes('checkpoint') || defenseTypeId.includes('gate')) return checkpointGeometry();
  return new ColorGeometryBuilder()
    .add(new THREE.CylinderGeometry(0.2, 0.25, 2.4, 6), SIDE_COLORS.defender, transform(0, 1.2, 0))
    .add(new THREE.OctahedronGeometry(0.45, 0), 0xffffff, transform(0, 2.7, 0))
    .build();
}
