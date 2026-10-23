import { Rng } from '@gtd/sim';
import * as THREE from 'three';
import { ColorGeometryBuilder, createFlatMaterial, transform } from '../geometryBuilder';
import { distanceToPath, type Point2 } from '../paths';
import type { PresetSettings } from '../presets';
import { leopardGeometry, lionGeometry } from './animals';
import {
  SAVANNA,
  acacia,
  broadleaf,
  bush,
  granite,
  grassTuftGeometry,
  reed,
  rock,
  termiteMound,
  thicket,
} from './props';
import {
  createGround,
  createHeightField,
  surfaceHeightField,
  loadGroundTexture,
  type HeightAt,
  type Landmark,
  type VisionShape,
} from './terrain';

export interface SavannaInput {
  size: number;
  seed: number;
  landmarks: Landmark[];
  animals: { kind: string; x: number; z: number; rotation: number; pose: 'standing' | 'lying' }[];
  streambed: Point2[] | null;
  /** Every route path; props keep clear of them so routes stay readable. */
  routes: Point2[][];
  /** Spots that must stay free (build zones, objective). */
  keepClear: Point2[];
  /** Concealment Zones, drawn as thickets, rock walls, ledges and clearings. */
  vision?: VisionShape[];
  flora?: 'savanna' | 'woodland';
}

export interface BuiltWorld {
  root: THREE.Group;
  heightAt: HeightAt;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * Builds a savanna level in code at the quality of the approved low-poly sample: textured faceted ground, umbrella
 * acacias, bushes, boulders, termite mounds, a dry streambed, a waterhole with reeds, resting lions and layered hills.
 * Static props are merged into one geometry; grass and pebbles are instanced.
 */
export function buildSavanna(input: SavannaInput, preset: PresetSettings, anisotropy: number): BuiltWorld {
  const root = new THREE.Group();
  root.name = 'savanna';
  const rng = new Rng(input.seed);
  const tracks = input.routes.filter((route) => route !== input.streambed);
  const vision = input.vision ?? [];
  const woodland = input.flora === 'woodland';
  const smoothHeight = createHeightField({
    size: input.size,
    landmarks: input.landmarks,
    vision,
    streambed: input.streambed,
    tracks,
  });
  const heightAt = surfaceHeightField(smoothHeight, input.size, preset.terrainSegments);
  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  const textures = {
    grass: own(loadGroundTexture('/art/textures/TEX-GRASS.jpg', 0xd9b56a, anisotropy)),
    dirt: own(loadGroundTexture('/art/textures/TEX-DIRT.jpg', 0xc79a62, anisotropy)),
    riverbed: own(loadGroundTexture('/art/textures/TEX-RIVERBED.jpg', 0xb08a5a, anisotropy)),
  };
  const ground = createGround(
    {
      size: input.size,
      landmarks: input.landmarks,
      vision,
      flora: input.flora,
      streambed: input.streambed,
      tracks,
    },
    smoothHeight,
    textures,
    preset,
  );
  own(ground.geometry);
  own(ground.material as THREE.Material);
  root.add(ground);

  const half = input.size / 2;
  const clearOf = (x: number, z: number, margin: number) => {
    for (const route of input.routes) if (distanceToPath(x, z, route) < margin) return false;
    for (const spot of input.keepClear) if (Math.hypot(x - spot.x, z - spot.z) < margin + 2) return false;
    for (const l of input.landmarks) {
      if (l.kind === 'waterhole' && Math.hypot(x - l.x, z - l.z) < l.radius + 5) return false;
      if (l.kind === 'kopje' && Math.hypot(x - l.x, z - l.z) < l.radius) return false;
    }
    // Clearings stay open, ledges bare rock, and the rock walls get their own boulders.
    for (const area of vision) {
      if (area.circle && area.kind !== 'brush') {
        if (Math.hypot(x - area.circle.x, z - area.circle.z) < area.circle.radius + 1) return false;
      } else if (area.wall && distanceToPath(x, z, area.wall.points) < area.wall.width + 1.5) return false;
    }
    return true;
  };
  const place = (x: number, z: number, rotation = 0, scale = 1) =>
    transform(x, heightAt(x, z), z, [0, rotation, 0], scale);

  // ---- Static props, merged into one mesh ----
  const props = new ColorGeometryBuilder();
  // Woodland levels grow mostly broad-leaf trees with a few acacias between them.
  const treeVariants = woodland
    ? [...Array.from({ length: 6 }, () => broadleaf(rng, 1)), acacia(rng, 1), acacia(rng, 0.9)]
    : Array.from({ length: 6 }, () => acacia(rng, 1));
  const thicketVariants = Array.from({ length: 5 }, () => thicket(rng));
  const graniteVariants = Array.from({ length: 8 }, (_, i) => granite(rng, 1, i < 4 ? 0.75 : 0.55));
  const bushVariants = Array.from({ length: 5 }, () => bush(rng));
  const mound = termiteMound();

  const scatter = (count: number, extent: number, margin: number, add: (x: number, z: number) => void) => {
    for (let i = 0; i < count; i++) {
      const x = rng.range(-extent, extent);
      const z = rng.range(-extent, extent);
      if (clearOf(x, z, margin)) add(x, z);
    }
  };
  // Acacias stand in loose groves with open grass between them, as in the approved sample.
  const groves = Math.round((woodland ? 85 : 34) * preset.treeDensity);
  for (let g = 0; g < groves; g++) {
    const cx = rng.range(-half * 0.8, half * 0.8);
    const cz = rng.range(-half * 0.8, half * 0.8);
    const trees = rng.int(2, 6);
    for (let t = 0; t < trees; t++) {
      const x = cx + rng.range(-7, 7);
      const z = cz + rng.range(-7, 7);
      if (clearOf(x, z, woodland ? 5.5 : 8.5))
        props.addColored(rng.pick(treeVariants), place(x, z, rng.range(0, 6), rng.range(0.75, 1.15)));
    }
  }
  scatter(Math.round(26 * preset.treeDensity), half * 0.82, 8.5, (x, z) =>
    props.addColored(rng.pick(treeVariants), place(x, z, rng.range(0, 6), rng.range(0.7, 1.05))),
  );
  scatter(Math.round((woodland ? 230 : 160) * preset.treeDensity), half * 0.72, 2.5, (x, z) =>
    props.addColored(rng.pick(bushVariants), place(x, z, rng.range(0, 6), rng.range(0.8, 1.2))),
  );
  if (woodland)
    scatter(45, half * 0.72, 2.5, (x, z) =>
      props.addColored(rng.pick(graniteVariants), place(x, z, rng.range(0, 6), rng.range(0.6, 1.8))),
    );
  else scatter(55, half * 0.72, 2, (x, z) => props.addColored(rock(rng, rng.range(0.4, 1.1)), place(x, z)));
  if (!woodland) scatter(14, half * 0.55, 3, (x, z) => props.addColored(mound, place(x, z, rng.range(0, 6))));

  // ---- Concealment Zones ----
  for (const area of vision) {
    if (area.kind === 'brush' && area.circle) {
      // Dense thicket right up to the trail: groups walking through are half hidden.
      const { x: cx, z: cz, radius } = area.circle;
      const count = Math.round(radius * radius * 1.1 * Math.max(0.5, preset.treeDensity));
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * radius;
        const x = cx + Math.cos(a) * d;
        const z = cz + Math.sin(a) * d;
        if (input.routes.some((route) => distanceToPath(x, z, route) < 1.8)) continue;
        if (input.keepClear.some((spot) => Math.hypot(x - spot.x, z - spot.z) < 3)) continue;
        props.addColored(rng.pick(thicketVariants), place(x, z, rng.range(0, 6), rng.range(0.8, 1.35)));
      }
    } else if (area.kind === 'rockWall' && area.wall) {
      // Stacked granite along the wall line, tall enough to read as a barrier to the eye.
      const points = area.wall.points;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1] as Point2;
        const b = points[i] as Point2;
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        for (let at = 0; at <= length; at += 1.5) {
          const t = at / length;
          const x = a.x + (b.x - a.x) * t + rng.range(-0.4, 0.4);
          const z = a.z + (b.z - a.z) * t + rng.range(-0.4, 0.4);
          props.addColored(granite(rng, rng.range(1.3, 2), 0.95), place(x, z));
          if (rng.next() < 0.6)
            props.addColored(
              granite(rng, rng.range(0.9, 1.4), 0.9),
              transform(x + rng.range(-0.5, 0.5), heightAt(x, z) + 1.6, z + rng.range(-0.5, 0.5)),
            );
        }
      }
    } else if (area.kind === 'ledge' && area.circle) {
      // Flat slabs around the rim of the shelf.
      const { x: cx, z: cz, radius } = area.circle;
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + rng.range(-0.2, 0.2);
        const x = cx + Math.cos(a) * (radius + rng.range(0.5, 2));
        const z = cz + Math.sin(a) * (radius + rng.range(0.5, 2));
        if (input.routes.some((route) => distanceToPath(x, z, route) < 2.2)) continue;
        props.addColored(rng.pick(graniteVariants), place(x, z, rng.range(0, 6), rng.range(1.2, 2)));
      }
    }
  }

  for (const landmark of input.landmarks) {
    if (landmark.kind === 'rockyRidge') {
      for (let i = 0; i < 26; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = Math.sqrt(rng.next()) * landmark.radius;
        const x = landmark.x + Math.cos(a) * d;
        const z = landmark.z + Math.sin(a) * d;
        if (clearOf(x, z, 2)) props.addColored(rock(rng, rng.range(0.9, 2.3)), place(x, z));
      }
    } else if (landmark.kind === 'acaciaGrove') {
      for (let i = 0; i < 9; i++) {
        const a = rng.range(0, Math.PI * 2);
        const d = landmark.radius + rng.range(1, 6);
        const x = landmark.x + Math.cos(a) * d;
        const z = landmark.z + Math.sin(a) * d;
        if (clearOf(x, z, 4))
          props.addColored(rng.pick(treeVariants), place(x, z, rng.range(0, 6), rng.range(1.2, 1.6)));
      }
    } else if (landmark.kind === 'riverCrossing') {
      for (let i = 0; i < 7; i++) {
        const x = landmark.x + rng.range(-landmark.radius, landmark.radius);
        const z = landmark.z + rng.range(-landmark.radius, landmark.radius);
        props.addColored(rock(rng, rng.range(0.35, 0.7)), place(x, z));
      }
    } else if (landmark.kind === 'kopje') {
      // Rounded granite boulders piled around a flat-topped rock where the leopard rests.
      props.addColored(granite(rng, KOPJE_TOP_ROCK, 0.5), place(landmark.x, landmark.z, rng.range(0, 6)));
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const d = landmark.radius * rng.range(0.45, 0.95);
        const x = landmark.x + Math.cos(a) * d;
        const z = landmark.z + Math.sin(a) * d;
        props.addColored(granite(rng, rng.range(1.6, 3), 0.8), place(x, z, rng.range(0, 6)));
      }
      props.addColored(
        broadleaf(rng, 1.3),
        place(landmark.x + landmark.radius * 0.7, landmark.z - landmark.radius * 0.6, 0.4),
      );
    } else if (landmark.kind === 'figTree') {
      props.addColored(broadleaf(rng, 2), place(landmark.x, landmark.z, rng.range(0, 6)));
    } else if (landmark.kind === 'ravine') {
      for (let i = 0; i < 12; i++) {
        const x = landmark.x + rng.range(-landmark.radius * 2, landmark.radius * 2);
        const z = landmark.z + rng.range(-landmark.radius, landmark.radius);
        if (input.routes.some((route) => distanceToPath(x, z, route) < 1.2)) continue;
        props.addColored(granite(rng, rng.range(0.3, 0.7)), place(x, z));
      }
    } else if (landmark.kind === 'entrance') {
      props.addColored(entranceGate(), place(landmark.x, landmark.z, landmark.rotation));
    }
  }

  const propMaterial = own(createFlatMaterial());
  const propMesh = new THREE.Mesh(own(props.build()), propMaterial);
  propMesh.castShadow = true;
  propMesh.receiveShadow = true;
  propMesh.name = 'props';
  root.add(propMesh);

  // ---- Waterholes ----
  const waterMaterials: THREE.ShaderMaterial[] = [];
  for (const hole of input.landmarks.filter((l) => l.kind === 'waterhole')) {
    const level = heightAt(hole.x, hole.z) + hole.radius * 0.16;
    const mud = new THREE.Mesh(
      own(new THREE.CircleGeometry(hole.radius * 1.16, 14)),
      own(createFlatMaterial({ vertexColors: false, color: SAVANNA.mud, roughness: 1 })),
    );
    mud.rotation.x = -Math.PI / 2;
    mud.position.set(hole.x, level - 0.05, hole.z);
    mud.receiveShadow = true;
    root.add(mud);
    const waterMaterial = own(createWaterMaterial());
    waterMaterials.push(waterMaterial);
    const water = new THREE.Mesh(own(new THREE.CircleGeometry(hole.radius, 24)), waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.set(hole.x, level, hole.z);
    root.add(water);
    const reeds = new ColorGeometryBuilder();
    for (let i = 0; i < 110; i++) {
      const a = rng.range(0, Math.PI * 2);
      if (a > 3.6 && a < 4.6) continue; // an open shore towards the observation zone
      const d = rng.range(hole.radius * 1.02, hole.radius * 1.25);
      const x = hole.x + Math.cos(a) * d;
      const z = hole.z + Math.sin(a) * d;
      reeds.addColored(reed(rng), place(x, z));
    }
    const reedMesh = new THREE.Mesh(own(reeds.build()), propMaterial);
    reedMesh.castShadow = true;
    root.add(reedMesh);
  }

  // ---- Grass tufts and riverbed pebbles, instanced ----
  const dummy = new THREE.Object3D();
  const tuftGeometry = own(grassTuftGeometry());
  const tufts = new THREE.InstancedMesh(
    tuftGeometry,
    own(new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 })),
    preset.grassTufts,
  );
  const tint = new THREE.Color();
  let tuftCount = 0;
  for (let i = 0; i < preset.grassTufts * 4 && tuftCount < preset.grassTufts; i++) {
    const x = rng.range(-half * 0.85, half * 0.85);
    const z = rng.range(-half * 0.85, half * 0.85);
    if (!clearOf(x, z, 2.4)) continue;
    dummy.position.set(x, heightAt(x, z), z);
    dummy.rotation.set(0, rng.range(0, 6), 0);
    dummy.scale.setScalar(rng.range(0.7, 1.5));
    dummy.updateMatrix();
    tufts.setMatrixAt(tuftCount, dummy.matrix);
    if (woodland) tint.setHSL(rng.range(0.17, 0.24), rng.range(0.35, 0.5), rng.range(0.38, 0.5));
    else tint.setHSL(rng.range(0.1, 0.14), rng.range(0.45, 0.6), rng.range(0.5, 0.62));
    tufts.setColorAt(tuftCount++, tint);
  }
  tufts.count = tuftCount;
  tufts.receiveShadow = true;
  tufts.name = 'grass';
  root.add(tufts);
  disposables.push({ dispose: () => tufts.dispose() });

  if (input.streambed) {
    const pebbles = new THREE.InstancedMesh(
      own(new THREE.DodecahedronGeometry(0.24, 0)),
      own(createFlatMaterial({ vertexColors: false, color: SAVANNA.pebble })),
      preset.pebbles,
    );
    let pebbleCount = 0;
    for (let i = 0; i < preset.pebbles * 8 && pebbleCount < preset.pebbles; i++) {
      const x = rng.range(-half * 0.6, half * 0.6);
      const z = rng.range(-half * 0.6, half * 0.6);
      if (distanceToPath(x, z, input.streambed) > 2.6) continue;
      dummy.position.set(x, heightAt(x, z) + 0.05, z);
      dummy.rotation.set(rng.range(0, 3), rng.range(0, 3), 0);
      dummy.scale.set(rng.range(0.7, 2), rng.range(0.5, 1.2), rng.range(0.7, 2));
      dummy.updateMatrix();
      pebbles.setMatrixAt(pebbleCount++, dummy.matrix);
    }
    pebbles.count = pebbleCount;
    pebbles.name = 'pebbles';
    root.add(pebbles);
    disposables.push({ dispose: () => pebbles.dispose() });
  }

  // ---- Animals ----
  const animalMeshes: THREE.Mesh[] = [];
  for (const animal of input.animals) {
    const lying = animal.pose === 'lying';
    let geometry: THREE.BufferGeometry;
    if (animal.kind === 'lion' || animal.kind === 'lioness')
      geometry = lionGeometry(animal.kind === 'lion', lying);
    // The leopard is drawn a little larger than life so it reads on its rock from the usual camera height.
    else if (animal.kind === 'leopard') geometry = leopardGeometry(lying).scale(1.6, 1.6, 1.6);
    else continue;
    const mesh = new THREE.Mesh(own(geometry), propMaterial);
    // An animal on a kopje lies on the flat rock at its top.
    const onRock = input.landmarks.some(
      (l) => l.kind === 'kopje' && Math.hypot(animal.x - l.x, animal.z - l.z) < KOPJE_TOP_ROCK,
    );
    const lift = onRock ? KOPJE_TOP_ROCK * 0.5 * 1.4 : 0;
    mesh.position.set(animal.x, heightAt(animal.x, animal.z) + lift, animal.z);
    mesh.rotation.y = animal.rotation;
    mesh.castShadow = true;
    mesh.name = animal.kind;
    animalMeshes.push(mesh);
    root.add(mesh);
  }

  root.add(createHills(input.size, own));

  return {
    root,
    heightAt,
    update(elapsed) {
      for (const material of waterMaterials) material.uniforms.time!.value = elapsed;
      // Slow breathing so the animals read as alive and at rest.
      animalMeshes.forEach((mesh, i) => mesh.scale.set(1, 1 + Math.sin(elapsed * 1.4 + i * 1.7) * 0.025, 1));
    },
    dispose() {
      disposables.forEach((thing) => thing.dispose());
    },
  };
}

/** Size of the flat rock on top of a kopje. */
const KOPJE_TOP_ROCK = 3;

function entranceGate(): THREE.BufferGeometry {
  const wood = 0x7a5532;
  return new ColorGeometryBuilder()
    .add(new THREE.CylinderGeometry(0.18, 0.22, 4, 6), wood, transform(-3, 2, 0))
    .add(new THREE.CylinderGeometry(0.18, 0.22, 4, 6), wood, transform(3, 2, 0))
    .add(new THREE.BoxGeometry(6.8, 0.3, 0.3), 0x5a3c22, transform(0, 3.8, 0))
    .add(new THREE.BoxGeometry(2.4, 0.8, 0.12), 0xe9dcb8, transform(0, 3.1, 0.1))
    .add(new THREE.PlaneGeometry(1, 0.6), 0xe8742c, transform(3.55, 3.4, 0))
    .build();
}

function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      time: { value: 0 },
      deep: { value: new THREE.Color(0x1f6680) },
      shallow: { value: new THREE.Color(0x4fa3b5) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 deep;
      uniform vec3 shallow;
      varying vec2 vUv;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        vec3 color = mix(deep, shallow, smoothstep(0.55, 1.0, r));
        float ripple = sin(r * 26.0 - time * 1.6) * 0.5 + 0.5;
        color += vec3(0.06) * ripple * smoothstep(0.2, 0.9, r);
        float glint = step(0.985, fract(sin(dot(floor(vUv * 60.0), vec2(12.9898, 78.233)) + floor(time * 2.0)) * 43758.5453));
        color += glint * 0.25;
        gl_FragColor = vec4(color, 0.94);
        #include <colorspace_fragment>
      }`,
  });
}

/** Three layered bands of distant hills all around, fading towards the sky. */
function createHills(size: number, own: <T extends { dispose(): void }>(thing: T) => T): THREE.Group {
  const group = new THREE.Group();
  const layers: [number, number, number, number][] = [
    [0xb98f6e, size * 0.85, 22, 0.95],
    [0x9d8a8a, size * 1.1, 34, 0.8],
    [0x8d93a8, size * 1.4, 48, 0.65],
  ];
  layers.forEach(([color, radius, height, opacity], layer) => {
    const segments = 96;
    const positions: number[] = [];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const h = (a: number) =>
        height * (0.35 + 0.65 * Math.abs(Math.sin(a * 3 + layer * 1.7) * Math.cos(a * 5.3 + layer)));
      const p = (a: number, y: number) => [Math.cos(a) * radius, y, Math.sin(a) * radius];
      positions.push(
        ...p(a0, -8),
        ...p(a1, -8),
        ...p(a1, h(a1)),
        ...p(a0, -8),
        ...p(a1, h(a1)),
        ...p(a0, h(a0)),
      );
    }
    const geometry = own(new THREE.BufferGeometry());
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = own(
      new THREE.MeshBasicMaterial({
        color,
        fog: false,
        transparent: true,
        opacity,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const band = new THREE.Mesh(geometry, material);
    band.renderOrder = -1 - layer;
    group.add(band);
  });
  group.name = 'hills';
  return group;
}
