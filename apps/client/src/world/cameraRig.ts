import * as THREE from 'three';
import {
  DEFAULT_LIMITS,
  blendCamera,
  cameraPosition,
  clampCamera,
  panByScreen,
  panByWorld,
  type CameraLimits,
  type CameraState,
} from './cameraMath';

const EDGE_PAN_PIXELS = 14;
const DOUBLE_TAP_MS = 320;

/**
 * Strategic camera controls (spec §15).
 * Mouse: left drag or screen edge pans, wheel zooms, right drag rotates, double-click focuses.
 * Touch: one finger pans, pinch zooms, two-finger twist rotates, double tap focuses.
 */
export class CameraRig {
  private target: CameraState;
  private current: CameraState;
  private readonly limits: CameraLimits;
  private readonly pointers = new Map<number, { x: number; y: number; button: number; type: string }>();
  private pinch: { distance: number; angle: number } | null = null;
  private lastTap = { time: 0, x: 0, y: 0 };
  private hover: { x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly abort = new AbortController();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly element: HTMLElement,
    start: CameraState,
    bounds: number,
    /** Ground mesh for double-click focus. */
    private readonly ground: THREE.Object3D,
    private readonly heightAt: (x: number, z: number) => number,
  ) {
    this.limits = { ...DEFAULT_LIMITS, bounds };
    this.target = clampCamera(start, this.limits);
    this.current = { ...this.target };
    this.attach();
    this.apply();
  }

  get state(): CameraState {
    return { ...this.current };
  }

  /** Moves smoothly to look at a point. */
  focus(x: number, z: number, distance = Math.min(this.target.distance, 45)): void {
    this.set({ ...this.target, x, z, distance });
  }

  set(next: CameraState): void {
    this.target = clampCamera(next, this.limits);
  }

  /** Called every frame; eases towards the requested view and applies edge panning. */
  update(dt: number): void {
    if (this.hover && this.pointers.size === 0 && document.hasFocus()) {
      const rect = this.element.getBoundingClientRect();
      const speed = this.target.distance * 0.9 * dt;
      let right = 0;
      let forward = 0;
      if (this.hover.x < EDGE_PAN_PIXELS) right -= speed;
      if (this.hover.x > rect.width - EDGE_PAN_PIXELS) right += speed;
      if (this.hover.y < EDGE_PAN_PIXELS) forward += speed;
      if (this.hover.y > rect.height - EDGE_PAN_PIXELS) forward -= speed;
      if (right || forward) this.set(panByWorld(this.target, right, forward));
    }
    this.current = blendCamera(this.current, this.target, 1 - Math.exp(-dt * 12));
    this.apply();
  }

  dispose(): void {
    this.abort.abort();
  }

  private apply(): void {
    const ground = this.heightAt(this.current.x, this.current.z);
    const p = cameraPosition(this.current, ground);
    this.camera.position.set(p.x, p.y, p.z);
    this.camera.lookAt(this.current.x, ground, this.current.z);
  }

  private attach(): void {
    const el = this.element;
    const signal = this.abort.signal;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    el.addEventListener('pointerdown', (e) => this.onDown(e), { signal });
    el.addEventListener('pointermove', (e) => this.onMove(e), { signal });
    el.addEventListener('pointerup', (e) => this.onUp(e), { signal });
    el.addEventListener('pointercancel', (e) => this.onUp(e), { signal });
    el.addEventListener('pointerleave', () => (this.hover = null), { signal });
    el.addEventListener('wheel', (e) => this.onWheel(e), { signal, passive: false });
    el.addEventListener('dblclick', (e) => this.focusAtScreen(e.clientX, e.clientY), { signal });
  }

  private onDown(e: PointerEvent): void {
    this.element.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, type: e.pointerType });
    if (this.pointers.size === 2) this.pinch = this.measurePinch();
    if (e.pointerType === 'touch' && this.pointers.size === 1) {
      const now = performance.now();
      if (
        now - this.lastTap.time < DOUBLE_TAP_MS &&
        Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30
      ) {
        this.focusAtScreen(e.clientX, e.clientY);
        this.lastTap.time = 0;
      } else {
        this.lastTap = { time: now, x: e.clientX, y: e.clientY };
      }
    }
  }

  private onMove(e: PointerEvent): void {
    const rect = this.element.getBoundingClientRect();
    if (e.pointerType === 'mouse') this.hover = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const pointer = this.pointers.get(e.pointerId);
    if (!pointer) return;
    const dx = e.clientX - pointer.x;
    const dy = e.clientY - pointer.y;
    pointer.x = e.clientX;
    pointer.y = e.clientY;

    if (this.pointers.size >= 2 && this.pinch) {
      const next = this.measurePinch();
      if (!next) return;
      this.set({
        ...this.target,
        distance: this.target.distance * (this.pinch.distance / Math.max(1, next.distance)),
        yaw: this.target.yaw - (next.angle - this.pinch.angle),
      });
      this.pinch = next;
      return;
    }
    if (pointer.type === 'mouse' && pointer.button === 2) {
      this.set({ ...this.target, yaw: this.target.yaw - dx * 0.006, pitch: this.target.pitch + dy * 0.004 });
      return;
    }
    if (pointer.button === 0 || pointer.type !== 'mouse') {
      this.set(panByScreen(this.target, dx, dy, rect.height, THREE.MathUtils.degToRad(this.camera.fov)));
    }
  }

  private onUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.pinch = this.pointers.size >= 2 ? this.measurePinch() : null;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const amount = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.set({ ...this.target, distance: this.target.distance * Math.exp(amount * 0.0012) });
  }

  private measurePinch(): { distance: number; angle: number } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return { distance: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  private focusAtScreen(clientX: number, clientY: number): void {
    const rect = this.element.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    if (hit) this.focus(hit.point.x, hit.point.z);
  }
}
