import * as THREE from 'three';
import { pathLength, sampleAlong, type Point2 } from './paths';
import type { HeightAt } from './savanna/terrain';

/** Route colours: distinct from each other and from the side colours, readable on sand (high-contrast markers). */
export const ROUTE_COLORS = [0xff9a3c, 0x56c2ff, 0xb38cff, 0x6fdc8c];
export const OBJECTIVE_COLOR = 0xffd447;

export interface MarkerSet {
  root: THREE.Group;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

/**
 * Lays a flat shape (built in the XY plane around the origin) onto the terrain around `at`, vertex by vertex, so
 * circles on slopes neither float nor disappear into the ground.
 */
export function drapeOnGround(
  geometry: THREE.BufferGeometry,
  at: Point2,
  heightAt: HeightAt,
  lift: number,
): THREE.BufferGeometry {
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(at.x, 0, at.z);
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, heightAt(positions.getX(i), positions.getZ(i)) + lift);
  }
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Ground markers drawn from level data: chevrons along every route, a dashed objective ring, and pads on the build
 * zones. They read the route graph only, so any stage pack gets them for free.
 */
export function createMarkers(
  routes: { path: Point2[]; color: number }[],
  objective: Point2 & { radius: number },
  buildZones: Point2[],
  heightAt: HeightAt,
): MarkerSet {
  const root = new THREE.Group();
  root.name = 'markers';
  const disposables: { dispose(): void }[] = [];

  const chevron = new THREE.Shape();
  chevron.moveTo(-0.7, -0.35);
  chevron.lineTo(0, 0.35);
  chevron.lineTo(0.7, -0.35);
  chevron.lineTo(0.7, -0.05);
  chevron.lineTo(0, 0.65);
  chevron.lineTo(-0.7, -0.05);
  const chevronGeometry = new THREE.ShapeGeometry(chevron);
  chevronGeometry.scale(1.3, 1.3, 1.3);
  chevronGeometry.rotateX(-Math.PI / 2);
  disposables.push(chevronGeometry);

  const dummy = new THREE.Object3D();
  const chevronMaterials: THREE.MeshBasicMaterial[] = [];
  for (const route of routes) {
    const length = pathLength(route.path);
    const spacing = 2.8;
    const count = Math.max(0, Math.floor((length - 4) / spacing));
    const material = new THREE.MeshBasicMaterial({
      color: route.color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    chevronMaterials.push(material);
    const mesh = new THREE.InstancedMesh(chevronGeometry, material, count);
    for (let i = 0; i < count; i++) {
      const at = sampleAlong(route.path, 2 + i * spacing);
      dummy.position.set(at.x, heightAt(at.x, at.z) + 0.12, at.z);
      // The chevron shape points along -z after rotation; turn it to face the direction of travel.
      dummy.rotation.set(0, at.heading + Math.PI, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.renderOrder = 1;
    root.add(mesh);
    disposables.push(material, { dispose: () => mesh.dispose() });
  }

  // Dashed objective ring.
  const dashes = 32;
  const dashGeometry = new THREE.RingGeometry(
    objective.radius - 0.45,
    objective.radius + 0.45,
    3,
    1,
    0,
    ((Math.PI * 2) / dashes) * 0.6,
  );
  dashGeometry.rotateX(-Math.PI / 2);
  const dashMaterial = new THREE.MeshBasicMaterial({
    color: OBJECTIVE_COLOR,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.InstancedMesh(dashGeometry, dashMaterial, dashes);
  const dashMiddle = ((Math.PI * 2) / dashes) * 0.3;
  for (let i = 0; i < dashes; i++) {
    const angle = (i / dashes) * Math.PI * 2;
    // Each dash sits on the ground under it, so the ring follows the slope instead of cutting into it.
    const x = objective.x + Math.cos(angle + dashMiddle) * objective.radius;
    const z = objective.z - Math.sin(angle + dashMiddle) * objective.radius;
    dummy.position.set(objective.x, heightAt(x, z) + 0.3, objective.z);
    dummy.rotation.set(0, angle, 0);
    dummy.updateMatrix();
    ring.setMatrixAt(i, dummy.matrix);
  }
  ring.renderOrder = 2;
  root.add(ring);
  const fill = new THREE.Mesh(
    drapeOnGround(new THREE.RingGeometry(0, objective.radius, 40, 4), objective, heightAt, 0.25),
    new THREE.MeshBasicMaterial({
      color: OBJECTIVE_COLOR,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    }),
  );
  root.add(fill);
  disposables.push(dashGeometry, dashMaterial, fill.geometry, fill.material as THREE.Material, {
    dispose: () => ring.dispose(),
  });

  // Build zone pads: a hexagon outline in defender blue.
  const padGeometry = new THREE.RingGeometry(1.7, 2, 6);
  padGeometry.rotateX(-Math.PI / 2);
  const padMaterial = new THREE.MeshBasicMaterial({
    color: 0x56a8ff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const pads = new THREE.InstancedMesh(padGeometry, padMaterial, Math.max(1, buildZones.length));
  buildZones.forEach((zone, i) => {
    dummy.position.set(zone.x, heightAt(zone.x, zone.z) + 0.15, zone.z);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    pads.setMatrixAt(i, dummy.matrix);
  });
  pads.count = buildZones.length;
  root.add(pads);
  disposables.push(padGeometry, padMaterial, { dispose: () => pads.dispose() });

  return {
    root,
    update(elapsed) {
      // Gentle pulse so routes read as live paths without distracting.
      chevronMaterials.forEach((m, i) => (m.opacity = 0.75 + Math.sin(elapsed * 2 + i) * 0.15));
      dashMaterial.color.setHex(OBJECTIVE_COLOR).multiplyScalar(0.85 + Math.sin(elapsed * 3) * 0.15);
    },
    dispose() {
      disposables.forEach((thing) => thing.dispose());
    },
  };
}
