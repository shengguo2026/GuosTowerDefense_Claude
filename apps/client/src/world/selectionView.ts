import * as THREE from 'three';
import type { Point2 } from './paths';
import type { HeightAt } from './savanna/terrain';

/** What the HUD wants marked on the map. Everything is optional; an empty overlay clears the marks. */
export interface MapOverlay {
  /** Places the chosen build item may go: allowed ones glow, the one under the pointer is brighter. */
  buildSites?: (Point2 & { id: string })[];
  /** The selected group or asset, followed as it moves. */
  selectedId?: number | null;
  /** Radius of an area ability being aimed; drawn under the pointer. */
  areaRadius?: number | null;
  /** Reach of the selected asset. */
  selectedRange?: number | null;
  /** Hot-seat: the Attacker's selected group (its own ring colour) and the junction cursor of the route schematic. */
  markedId?: number | null;
  cursor?: Point2 | null;
}

const SITE_COLOR = 0x7dffb0;
const SELECT_COLOR = 0xffffff;
const AIM_COLOR = 0xffd447;
const ATTACKER_COLOR = 0xffa24a;

/**
 * Selection marks on the ground: glowing build sites while placing, a ring around the selected group or asset, and
 * the reach of an area ability while aiming it. Only reads what the HUD asks for; never changes the match.
 */
export class SelectionView {
  readonly root = new THREE.Group();
  private readonly sites: THREE.InstancedMesh;
  private readonly siteMaterial = new THREE.MeshBasicMaterial({
    color: SITE_COLOR,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  private readonly ring: THREE.Mesh;
  private readonly aim: THREE.Mesh;
  private readonly aimFill: THREE.Mesh;
  private readonly reach: THREE.Mesh;
  private readonly marked: THREE.Mesh;
  private readonly cursor: THREE.Mesh;
  private readonly beacon: THREE.Mesh;
  private readonly dummy = new THREE.Object3D();
  private overlay: MapOverlay = {};
  private hoverSite: string | null = null;
  private hoverPoint: Point2 | null = null;
  private siteList: (Point2 & { id: string })[] = [];

  constructor(private readonly heightAt: HeightAt) {
    this.root.name = 'selection';
    const siteGeometry = new THREE.RingGeometry(1.6, 2.3, 6);
    siteGeometry.rotateX(-Math.PI / 2);
    this.sites = new THREE.InstancedMesh(siteGeometry, this.siteMaterial, 64);
    this.sites.count = 0;
    this.sites.frustumCulled = false;
    this.sites.renderOrder = 3;
    this.root.add(this.sites);

    const flat = (geometry: THREE.BufferGeometry) => geometry.rotateX(-Math.PI / 2);
    const line = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.ring = new THREE.Mesh(flat(new THREE.RingGeometry(1, 1.18, 48)), line(SELECT_COLOR, 0.95));
    this.aim = new THREE.Mesh(flat(new THREE.RingGeometry(0.96, 1, 64)), line(AIM_COLOR, 0.95));
    this.aimFill = new THREE.Mesh(flat(new THREE.CircleGeometry(1, 48)), line(AIM_COLOR, 0.16));
    this.reach = new THREE.Mesh(flat(new THREE.RingGeometry(0.97, 1, 64)), line(SELECT_COLOR, 0.7));
    this.marked = new THREE.Mesh(flat(new THREE.RingGeometry(1, 1.2, 48)), line(ATTACKER_COLOR, 0.95));
    this.cursor = new THREE.Mesh(flat(new THREE.RingGeometry(2.4, 3, 6)), line(ATTACKER_COLOR, 0.95));
    this.beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 6, 8, 1, true),
      line(ATTACKER_COLOR, 0.6),
    );
    this.beacon.geometry.translate(0, 3, 0);
    for (const mesh of [
      this.ring,
      this.aim,
      this.aimFill,
      this.reach,
      this.marked,
      this.cursor,
      this.beacon,
    ]) {
      mesh.visible = false;
      mesh.renderOrder = 4;
      this.root.add(mesh);
    }
  }

  set(overlay: MapOverlay): void {
    this.overlay = overlay;
    this.siteList = overlay.buildSites ?? [];
  }

  /** The pointer is over this build site and ground point (null when off the map). */
  hover(siteId: string | null, point: Point2 | null): void {
    this.hoverSite = siteId;
    this.hoverPoint = point;
  }

  /** Called every frame with where the selected entity (and the Attacker's marked group) is now. */
  update(elapsed: number, selected: Point2 | null, marked: Point2 | null = null): void {
    const d = this.dummy;
    const pulse = 1 + Math.sin(elapsed * 4) * 0.06;
    this.sites.count = Math.min(this.siteList.length, 64);
    this.siteList.slice(0, 64).forEach((site, i) => {
      const scale = site.id === this.hoverSite ? 1.25 * pulse : pulse;
      d.position.set(site.x, this.heightAt(site.x, site.z) + 0.3, site.z);
      d.rotation.set(0, elapsed * 0.4, 0);
      d.scale.set(scale, 1, scale);
      d.updateMatrix();
      this.sites.setMatrixAt(i, d.matrix);
    });
    this.sites.instanceMatrix.needsUpdate = true;

    this.ring.visible = selected !== null;
    this.reach.visible = selected !== null && (this.overlay.selectedRange ?? 0) > 0;
    if (selected) {
      const y = this.heightAt(selected.x, selected.z) + 0.35;
      this.ring.position.set(selected.x, y, selected.z);
      this.ring.scale.setScalar(2.6 * pulse);
      const range = this.overlay.selectedRange ?? 0;
      this.reach.position.set(selected.x, y, selected.z);
      this.reach.scale.setScalar(range);
    }

    this.marked.visible = marked !== null;
    if (marked) {
      this.marked.position.set(marked.x, this.heightAt(marked.x, marked.z) + 0.4, marked.z);
      this.marked.scale.setScalar(2.9 * pulse);
    }
    const cursor = this.overlay.cursor ?? null;
    this.cursor.visible = this.beacon.visible = cursor !== null;
    if (cursor) {
      const y = this.heightAt(cursor.x, cursor.z) + 0.45;
      this.cursor.position.set(cursor.x, y, cursor.z);
      this.cursor.rotation.y = elapsed * 0.8;
      this.cursor.scale.setScalar(pulse);
      this.beacon.position.set(cursor.x, y, cursor.z);
    }

    const radius = this.overlay.areaRadius ?? 0;
    const aiming = radius > 0 && this.hoverPoint !== null;
    this.aim.visible = this.aimFill.visible = aiming;
    if (aiming && this.hoverPoint) {
      const { x, z } = this.hoverPoint;
      const y = this.heightAt(x, z) + 0.4;
      for (const mesh of [this.aim, this.aimFill]) {
        mesh.position.set(x, y, z);
        mesh.scale.setScalar(radius);
      }
    }
  }

  get selectedId(): number | null {
    return this.overlay.selectedId ?? null;
  }

  get markedId(): number | null {
    return this.overlay.markedId ?? null;
  }

  dispose(): void {
    this.sites.geometry.dispose();
    this.siteMaterial.dispose();
    this.sites.dispose();
    for (const mesh of [
      this.ring,
      this.aim,
      this.aimFill,
      this.reach,
      this.marked,
      this.cursor,
      this.beacon,
    ]) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
