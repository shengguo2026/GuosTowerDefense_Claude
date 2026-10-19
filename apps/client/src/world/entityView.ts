import type { DefenseEntity, GroupEntity, MatchSnapshot } from '@gtd/sim';
import * as THREE from 'three';
import { createFlatMaterial } from './geometryBuilder';
import { drapeOnGround } from './markers';
import { LOOKS, SIDE_COLORS, personGeometry, type LookName } from './models/people';
import { defenseGeometry } from './models/structures';
import type { HeightAt } from './savanna/terrain';
import type { InterpolatedEntity } from './snapshotBuffer';

const MAX_FIGURES = 240;
const MAX_GROUPS = 64;
const RING_SEEN = new THREE.Color(SIDE_COLORS.attacker);
const RING_UNSEEN = new THREE.Color(0x9aa3ad);

/** Which figure a unit type uses; stage packs with other units fall back to the side's default look. */
function lookFor(unitTypeId: string): LookName {
  if (unitTypeId.includes('scout')) return 'scout';
  if (unitTypeId.includes('ranger')) return 'ranger';
  return 'explorer';
}

export interface DefenseRanges {
  [defenseTypeId: string]: number;
}

/**
 * Draws the match from simulation snapshots only (the render adapter of the plan): groups as small walking teams with
 * a ring in the side colour, defenses as models with their range on the ground. Figures are instanced, so a hundred
 * people cost a handful of draw calls.
 */
export class EntityView {
  readonly root = new THREE.Group();
  private readonly figures: Record<LookName, THREE.InstancedMesh>;
  private readonly rings: THREE.InstancedMesh;
  private readonly blobs: THREE.InstancedMesh;
  /** Hot-seat shows everything to both players; groups no defense has detected float a "hidden" mark (spec §5.2). */
  private readonly hiddenMarks: THREE.InstancedMesh | null;
  private readonly defenseMeshes = new Map<number, THREE.Group>();
  private readonly defenseGeometries = new Map<string, THREE.BufferGeometry>();
  private readonly material = createFlatMaterial();
  private readonly rangeFill = new THREE.MeshBasicMaterial({
    color: 0x56a8ff,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
  });
  private readonly rangeLine = new THREE.MeshBasicMaterial({
    color: 0x56a8ff,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  private readonly dummy = new THREE.Object3D();

  constructor(
    private readonly heightAt: HeightAt,
    private readonly ranges: DefenseRanges,
    blobTexture: THREE.Texture,
    hiddenMarkers = false,
  ) {
    this.root.name = 'entities';
    this.figures = Object.fromEntries(
      (Object.keys(LOOKS) as LookName[]).map((look) => {
        const mesh = new THREE.InstancedMesh(personGeometry(LOOKS[look]), this.material, MAX_FIGURES);
        mesh.castShadow = true;
        mesh.count = 0;
        mesh.frustumCulled = false;
        this.root.add(mesh);
        return [look, mesh];
      }),
    ) as unknown as Record<LookName, THREE.InstancedMesh>;

    const ringGeometry = new THREE.RingGeometry(1, 1.12, 40);
    ringGeometry.rotateX(-Math.PI / 2);
    this.rings = new THREE.InstancedMesh(
      ringGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }),
      MAX_GROUPS,
    );
    // Per-group colour: the side colour once the Defender has detected the group, grey while it is unseen.
    this.rings.setColorAt(0, RING_SEEN);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.root.add(this.rings);

    const blobGeometry = new THREE.PlaneGeometry(1, 1);
    blobGeometry.rotateX(-Math.PI / 2);
    this.blobs = new THREE.InstancedMesh(
      blobGeometry,
      new THREE.MeshBasicMaterial({ map: blobTexture, transparent: true, depthWrite: false }),
      MAX_FIGURES,
    );
    this.blobs.count = 0;
    this.blobs.frustumCulled = false;
    this.root.add(this.blobs);

    this.hiddenMarks = hiddenMarkers
      ? new THREE.InstancedMesh(
          new THREE.OctahedronGeometry(0.55, 0),
          new THREE.MeshBasicMaterial({ color: 0xdfe6ee, transparent: true, opacity: 0.85, wireframe: true }),
          MAX_GROUPS,
        )
      : null;
    if (this.hiddenMarks) {
      this.hiddenMarks.count = 0;
      this.hiddenMarks.frustumCulled = false;
      this.hiddenMarks.name = 'hidden-marks';
      this.root.add(this.hiddenMarks);
    }
  }

  update(snapshot: MatchSnapshot | null, positions: Map<number, InterpolatedEntity>, elapsed: number): void {
    const counts: Record<LookName, number> = { explorer: 0, scout: 0, ranger: 0 };
    let rings = 0;
    let blobs = 0;
    let hidden = 0;
    const seenDefenses = new Set<number>();
    const d = this.dummy;

    for (const entity of snapshot?.entities ?? []) {
      const at = positions.get(entity.id);
      if (!at) continue;
      if (entity.kind === 'group') {
        const look = lookFor((entity as GroupEntity).unitTypeId);
        const mesh = this.figures[look];
        // A detected but not yet identified group shows up with an unknown size: drawn as one figure.
        const members = Math.min(Math.max(entity.count, 1), 8);
        const forward = { x: Math.sin(at.heading), z: Math.cos(at.heading) };
        const side = { x: forward.z, z: -forward.x };
        for (let m = 0; m < members && counts[look] < MAX_FIGURES; m++) {
          // Column formation: pairs walking one behind the other.
          const row = Math.floor(m / 2);
          const offsetSide = members === 1 ? 0 : m % 2 === 0 ? -0.45 : 0.45;
          const x = at.x - forward.x * row * 1.1 + side.x * offsetSide;
          const z = at.z - forward.z * row * 1.1 + side.z * offsetSide;
          const bob = at.moving ? Math.abs(Math.sin(elapsed * 9 + entity.id * 1.3 + m)) * 0.08 : 0;
          d.position.set(x, this.heightAt(x, z) + bob, z);
          d.rotation.set(0, at.heading, at.moving ? Math.sin(elapsed * 9 + m) * 0.05 : 0);
          d.scale.setScalar(1);
          d.updateMatrix();
          mesh.setMatrixAt(counts[look]++, d.matrix);
          if (blobs < MAX_FIGURES) {
            d.position.set(x, this.heightAt(x, z) + 0.05, z);
            d.rotation.set(0, 0, 0);
            d.scale.set(1.1, 1, 1.1);
            d.updateMatrix();
            this.blobs.setMatrixAt(blobs++, d.matrix);
          }
        }
        if (rings < MAX_GROUPS) {
          const radius = 1.2 + members * 0.25;
          const cx = at.x - forward.x * Math.floor((members - 1) / 2) * 0.55;
          const cz = at.z - forward.z * Math.floor((members - 1) / 2) * 0.55;
          d.position.set(cx, this.heightAt(cx, cz) + 0.12, cz);
          d.rotation.set(0, 0, 0);
          d.scale.set(radius, 1, radius);
          d.updateMatrix();
          this.rings.setColorAt(rings, entity.detection === 'unknown' ? RING_UNSEEN : RING_SEEN);
          this.rings.setMatrixAt(rings++, d.matrix);
        }
        if (this.hiddenMarks && entity.detection === 'unknown' && hidden < MAX_GROUPS) {
          d.position.set(
            at.x,
            this.heightAt(at.x, at.z) + 3.2 + Math.sin(elapsed * 2 + entity.id) * 0.15,
            at.z,
          );
          d.rotation.set(0, elapsed * 1.5, 0);
          d.scale.set(1, 1.4, 1);
          d.updateMatrix();
          this.hiddenMarks.setMatrixAt(hidden++, d.matrix);
        }
      } else {
        seenDefenses.add(entity.id);
        if (!this.defenseMeshes.has(entity.id)) this.addDefense(entity as DefenseEntity);
        // Patrols walk the route network; their model and reach follow them.
        if (entity.mobile) {
          const group = this.defenseMeshes.get(entity.id) as THREE.Group;
          const y = this.heightAt(at.x, at.z);
          group.children[0]?.position.set(at.x, y, at.z);
          if (group.children[0]) group.children[0].rotation.y = at.heading;
          for (const ring of group.children.slice(1)) ring.position.set(at.x, y + 0.3, at.z);
        }
      }
    }

    for (const [id, group] of this.defenseMeshes) {
      if (!seenDefenses.has(id)) {
        this.root.remove(group);
        group.children.forEach(
          (child) => child !== group.children[0] && (child as THREE.Mesh).geometry.dispose(),
        );
        this.defenseMeshes.delete(id);
      }
    }

    for (const look of Object.keys(counts) as LookName[]) {
      this.figures[look].count = counts[look];
      this.figures[look].instanceMatrix.needsUpdate = true;
    }
    this.rings.count = rings;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
    this.blobs.count = blobs;
    this.blobs.instanceMatrix.needsUpdate = true;
    if (this.hiddenMarks) {
      this.hiddenMarks.count = hidden;
      this.hiddenMarks.instanceMatrix.needsUpdate = true;
    }
  }

  /** How many groups carry the hidden mark (for tests). */
  get hiddenCount(): number {
    return this.hiddenMarks?.count ?? 0;
  }

  dispose(): void {
    Object.values(this.figures).forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.dispose();
    });
    for (const mesh of [this.rings, this.blobs, ...(this.hiddenMarks ? [this.hiddenMarks] : [])]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.defenseGeometries.forEach((g) => g.dispose());
    this.defenseMeshes.forEach((group) =>
      group.children.slice(1).forEach((child) => (child as THREE.Mesh).geometry.dispose()),
    );
    this.material.dispose();
    this.rangeFill.dispose();
    this.rangeLine.dispose();
  }

  private addDefense(defense: DefenseEntity): void {
    let geometry = this.defenseGeometries.get(defense.defenseTypeId);
    if (!geometry) {
      geometry = defenseGeometry(defense.defenseTypeId);
      this.defenseGeometries.set(defense.defenseTypeId, geometry);
    }
    const group = new THREE.Group();
    const y = this.heightAt(defense.x, defense.z);
    const model = new THREE.Mesh(geometry, this.material);
    model.position.set(defense.x, y, defense.z);
    model.rotation.y = (defense.id * 1.7) % (Math.PI * 2);
    model.castShadow = true;
    model.receiveShadow = true;
    group.add(model);
    const range = this.ranges[defense.defenseTypeId] ?? 5;
    if (defense.mobile) {
      // A moving reach cannot be draped once, so it is a flat ring that rides along slightly above the ground.
      const flat = (geometry: THREE.RingGeometry) => geometry.rotateX(-Math.PI / 2);
      group.add(
        new THREE.Mesh(flat(new THREE.RingGeometry(0, range, 40)), this.rangeFill),
        new THREE.Mesh(flat(new THREE.RingGeometry(range - 0.15, range, 48)), this.rangeLine),
      );
      this.defenseMeshes.set(defense.id, group);
      this.root.add(group);
      return;
    }
    const at = { x: defense.x, z: defense.z };
    // Several radial rings of vertices let the disc follow the terrain inside, not only at its edge.
    const fill = new THREE.Mesh(
      drapeOnGround(new THREE.RingGeometry(0, range, 48, 8), at, this.heightAt, 0.2),
      this.rangeFill,
    );
    const line = new THREE.Mesh(
      drapeOnGround(new THREE.RingGeometry(range - 0.15, range, 64), at, this.heightAt, 0.24),
      this.rangeLine,
    );
    group.add(fill, line);
    this.defenseMeshes.set(defense.id, group);
    this.root.add(group);
  }
}

/** Soft round shadow drawn under figures and props, so they sit on the ground even with real shadows off. */
export function createBlobTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(40,25,10,0.55)');
    gradient.addColorStop(1, 'rgba(40,25,10,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
