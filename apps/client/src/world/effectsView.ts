import type { AreaEffect, MatchSnapshot } from '@gtd/sim';
import * as THREE from 'three';
import { ColorGeometryBuilder, createFlatMaterial, transform } from './geometryBuilder';
import { SIDE_COLORS } from './models/people';
import type { HeightAt } from './savanna/terrain';

const MAX_AREAS = 16;
const MAX_CLOSURES = 8;
/** Reveals and scans read as a search light; everything else takes the colour of the side that used it. */
const REVEAL_COLOR = new THREE.Color(0xffd447);

/** A closed branch: two striped barrier arms crossing over the node. */
function closureGeometry(): THREE.BufferGeometry {
  const b = new ColorGeometryBuilder();
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    for (let k = 0; k < 6; k++) {
      const along = -1.5 + k * 0.6;
      b.add(
        new THREE.BoxGeometry(0.6, 0.16, 0.16),
        k % 2 ? 0xffffff : 0xd23b3b,
        transform(Math.cos(angle) * along, 1.1, Math.sin(angle) * along, [0, -angle, 0]),
      );
    }
  }
  for (const x of [-1.2, 1.2])
    b.add(new THREE.CylinderGeometry(0.1, 0.12, 1.2, 6), SIDE_COLORS.defender, transform(x, 0.6, 0));
  return b.build();
}

function colorOf(effect: AreaEffect): THREE.Color {
  if (effect.effects.includes('reveal')) return REVEAL_COLOR;
  return new THREE.Color(SIDE_COLORS[effect.side]);
}

/**
 * Running abilities and commands on the ground: a soft pulsing disc for each area effect the viewer may see, and a
 * crossed barrier on every branch the Defender has closed for a while. Reads snapshots only.
 */
export class EffectsView {
  readonly root = new THREE.Group();
  private readonly discs: THREE.InstancedMesh;
  private readonly edges: THREE.InstancedMesh;
  private readonly closures: THREE.InstancedMesh;
  private readonly material = createFlatMaterial();
  private readonly dummy = new THREE.Object3D();

  constructor(private readonly heightAt: HeightAt) {
    this.root.name = 'effects';
    const flat = (geometry: THREE.BufferGeometry) => geometry.rotateX(-Math.PI / 2);
    this.discs = new THREE.InstancedMesh(
      flat(new THREE.CircleGeometry(1, 40)),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        depthTest: false,
      }),
      MAX_AREAS,
    );
    this.edges = new THREE.InstancedMesh(
      flat(new THREE.RingGeometry(0.95, 1, 64)),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        depthTest: false,
      }),
      MAX_AREAS,
    );
    this.closures = new THREE.InstancedMesh(closureGeometry(), this.material, MAX_CLOSURES);
    for (const mesh of [this.discs, this.edges, this.closures]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    // A flat disc would vanish under every hill inside it, so effects draw over the ground like the selection marks.
    this.discs.renderOrder = this.edges.renderOrder = 3;
    // Instance colours must exist before the first draw, or the shader is built without them.
    for (const mesh of [this.discs, this.edges]) mesh.setColorAt(0, REVEAL_COLOR);
    this.closures.name = 'closures';
    this.discs.name = 'area-effects';
  }

  update(snapshot: MatchSnapshot | null, elapsed: number): void {
    const d = this.dummy;
    let areas = 0;
    // Route-wide effects follow a whole route; the route highlight shows those, so only areas get a disc.
    for (const effect of snapshot?.areaEffects ?? []) {
      if (effect.routeId || effect.radius <= 0 || areas >= MAX_AREAS) continue;
      const pulse = 1 + Math.sin(elapsed * 3 + areas) * 0.03;
      d.position.set(effect.x, this.heightAt(effect.x, effect.z) + 0.25, effect.z);
      d.rotation.set(0, 0, 0);
      d.scale.set(effect.radius * pulse, 1, effect.radius * pulse);
      d.updateMatrix();
      const color = colorOf(effect);
      this.discs.setMatrixAt(areas, d.matrix);
      this.edges.setMatrixAt(areas, d.matrix);
      this.discs.setColorAt(areas, color);
      this.edges.setColorAt(areas, color);
      areas++;
    }
    let closures = 0;
    for (const closure of snapshot?.closures ?? []) {
      if (closures >= MAX_CLOSURES) break;
      d.position.set(closure.x, this.heightAt(closure.x, closure.z), closure.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      this.closures.setMatrixAt(closures++, d.matrix);
    }
    this.discs.count = this.edges.count = areas;
    this.closures.count = closures;
    for (const mesh of [this.discs, this.edges, this.closures]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  /** How many area effects and closures are drawn (for tests). */
  get counts(): { areas: number; closures: number } {
    return { areas: this.discs.count, closures: this.closures.count };
  }

  dispose(): void {
    for (const mesh of [this.discs, this.edges, this.closures]) {
      mesh.geometry.dispose();
      if (mesh !== this.closures) (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.material.dispose();
  }
}
