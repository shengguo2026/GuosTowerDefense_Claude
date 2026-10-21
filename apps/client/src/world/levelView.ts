import type { Level, StagePack } from '@gtd/content-schema';
import { routePath, type MatchSnapshot } from '@gtd/sim';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CameraRig } from './cameraRig';
import type { CameraState } from './cameraMath';
import { EffectsView } from './effectsView';
import { EntityView, createBlobTexture } from './entityView';
import { ROUTE_COLORS, createMarkers } from './markers';
import type { Point2 } from './paths';
import { sampleAlong, pathLength } from './paths';
import type { PresetSettings } from './presets';
import { buildSavanna } from './savanna/buildSavanna';
import { SelectionView, type MapOverlay } from './selectionView';
import { SnapshotBuffer, type InterpolatedEntity } from './snapshotBuffer';

const SKY_TOP = new THREE.Color(0x6aa7d8);
const SKY_HORIZON = new THREE.Color(0xf7d9a8);
const FOG = new THREE.Color(0xe9c99a);

export interface RenderStats {
  preset: string;
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  pixelRatio: number;
}

export interface WorldLabel {
  text: string;
  kind: 'landmark' | 'route';
  x: number;
  z: number;
  /** Route labels carry the route colour. */
  color?: string;
}

export interface LevelViewOptions {
  canvas: HTMLCanvasElement;
  labelLayer: HTMLElement;
  pack: StagePack;
  level: Level;
  preset: PresetSettings;
  /** Translates the stage's own text keys (landmark and route names). */
  stageText(key: string): string;
  reducedMotion: boolean;
  highContrastRoutes?: boolean;
  /** Hot-seat: both players see everything, so undetected groups get a "hidden" mark. */
  hiddenMarkers?: boolean;
}

/** What is under a point on the screen: the nearest entity, map node and route within reach, and the ground. */
export interface MapPick {
  ground: Point2 | null;
  entityId: number | null;
  nodeId: string | null;
  routeId: string | null;
}

export interface MapPointerHandler {
  tap(pick: MapPick, button: number, screen: { x: number; y: number }): void;
  hover?(pick: MapPick): void;
}

/** How close (in screen pixels) a click must be to count as on an entity, a node or a route. */
const PICK_ENTITY_PX = 34;
const PICK_NODE_PX = 30;
const PICK_ROUTE_PX = 22;

declare global {
  interface Window {
    /** Renderer numbers for automated tests and the performance overlay. */
    __gtdRenderInfo?: RenderStats;
  }
}

/** Route paths of a level, expanded with their bend points, in route order. */
export function levelRoutePaths(level: Level): { id: string; name?: string; path: Point2[] }[] {
  const nodes = new Map(level.map.nodes.map((n) => [n.id, { id: n.id, x: n.x, z: n.z }]));
  return level.routes.map((route) => ({
    id: route.id,
    name: route.name,
    path: routePath(route, nodes, level.map.edges),
  }));
}

/**
 * One level on screen: renderer, sky and light, the world kit, ground markers, camera rig, labels and the match
 * entities. It only reads level data and match snapshots, never changes them.
 */
export class LevelView {
  readonly buffer = new SnapshotBuffer();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
  private readonly rig: CameraRig;
  private readonly world: ReturnType<typeof buildSavanna>;
  private readonly markers: ReturnType<typeof createMarkers>;
  private readonly entities: EntityView;
  private readonly selection: SelectionView;
  private readonly effects: EffectsView;
  private positions = new Map<number, InterpolatedEntity>();
  private readonly routeSamples: { routeId: string; point: THREE.Vector3 }[] = [];
  private readonly nodePoints: { id: string; point: THREE.Vector3 }[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground: THREE.Object3D;
  private readonly labels: {
    element: HTMLElement;
    position: THREE.Vector3;
    width: number;
    height: number;
  }[] = [];
  private readonly observer: ResizeObserver;
  private readonly clock = new THREE.Clock();
  private readonly sun: THREE.DirectionalLight;
  private readonly owned: { dispose(): void }[] = [];
  private lastFrameAt = 0;
  private smoothedMs = 0;
  private lastStatsAt = 0;
  private stats: RenderStats;
  private readonly startCamera: CameraState;

  constructor(private readonly options: LevelViewOptions) {
    const { canvas, level, preset } = options;
    const scene = level.scene ?? { kit: 'savanna', seed: 1, size: 200, landmarks: [], animals: [] };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = preset.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.owned.push(environment);
    this.scene.environment = environment;
    this.scene.environmentIntensity = 0.35;
    this.scene.fog = new THREE.Fog(FOG, 160, 520);
    this.scene.add(this.own(createSky()));

    this.scene.add(new THREE.HemisphereLight(0xcfe3ff, 0xa07a45, 0.9));
    this.sun = new THREE.DirectionalLight(0xffd59a, 2.8);
    this.sun.position.set(-50, 38, 10);
    if (preset.shadowMapSize > 0) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      const reach = 85;
      Object.assign(this.sun.shadow.camera, {
        left: -reach,
        right: reach,
        top: reach,
        bottom: -reach,
        near: 1,
        far: 260,
      });
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun, this.sun.target);
    const rim = new THREE.DirectionalLight(0x9cc4ff, 0.6);
    rim.position.set(40, 25, -45);
    this.scene.add(rim);

    const routes = levelRoutePaths(level);
    const streambed = routes.find((r) => r.id === scene.streambedRoute)?.path ?? null;
    const objectiveNode = level.map.nodes.find((n) => n.id === level.objective.nodeId);
    const buildZones = level.map.nodes.filter((n) => n.buildable).map((n) => ({ x: n.x, z: n.z }));
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    this.world = buildSavanna(
      {
        size: scene.size,
        seed: scene.seed,
        landmarks: scene.landmarks,
        animals: scene.animals,
        streambed,
        routes: routes.map((r) => r.path),
        keepClear: [...buildZones, ...(objectiveNode ? [{ x: objectiveNode.x, z: objectiveNode.z }] : [])],
      },
      preset,
      anisotropy,
    );
    this.scene.add(this.world.root);

    this.markers = createMarkers(
      routes.map((route, i) => ({
        path: route.path,
        color: ROUTE_COLORS[i % ROUTE_COLORS.length] as number,
      })),
      { x: objectiveNode?.x ?? 0, z: objectiveNode?.z ?? 0, radius: 4.5 },
      buildZones,
      this.world.heightAt,
      options.highContrastRoutes,
    );
    this.scene.add(this.markers.root);
    this.selection = new SelectionView(this.world.heightAt);
    this.scene.add(this.selection.root);
    this.effects = new EffectsView(this.world.heightAt);
    this.scene.add(this.effects.root);
    for (const route of routes) {
      const length = pathLength(route.path);
      for (let at = 0; at <= length; at += 2) {
        const p = sampleAlong(route.path, at);
        this.routeSamples.push({
          routeId: route.id,
          point: new THREE.Vector3(p.x, this.world.heightAt(p.x, p.z), p.z),
        });
      }
    }
    for (const node of level.map.nodes)
      this.nodePoints.push({
        id: node.id,
        point: new THREE.Vector3(node.x, this.world.heightAt(node.x, node.z), node.z),
      });

    const blob = createBlobTexture();
    this.owned.push(blob);
    const ranges = Object.fromEntries(options.pack.catalog.defenses.map((d) => [d.id, d.range]));
    const { units, defenses } = options.pack.catalog;
    this.entities = new EntityView(this.world.heightAt, ranges, blob, options.hiddenMarkers, {
      units: Object.fromEntries(units.map((u) => [u.id, u.model])),
      defenses: Object.fromEntries(defenses.map((d) => [d.id, d.model])),
    });
    this.scene.add(this.entities.root);

    this.startCamera = scene.camera ?? { x: 0, z: 0, yaw: -0.6, pitch: 0.7, distance: 90 };
    const ground = this.world.root.getObjectByName('ground') ?? this.world.root;
    this.ground = ground;
    this.rig = new CameraRig(
      this.camera,
      canvas,
      this.startCamera,
      scene.size * 0.32,
      ground,
      this.world.heightAt,
    );

    this.createLabels(routes);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();

    this.stats = {
      preset: preset.name,
      fps: 0,
      frameMs: 0,
      drawCalls: 0,
      triangles: 0,
      geometries: 0,
      textures: 0,
      pixelRatio: this.renderer.getPixelRatio(),
    };
    this.renderer.setAnimationLoop((time: number) => this.frame(time));
    if (new URLSearchParams(location.search).has('debug'))
      Object.assign(window, { __gtdScene: this.scene, __gtdView: this });
  }

  get renderStats(): RenderStats {
    return this.stats;
  }

  pushSnapshot(snapshot: MatchSnapshot): void {
    this.buffer.push(snapshot, performance.now());
  }

  resetCamera(): void {
    this.rig.set(this.startCamera);
  }

  /** Moves the camera smoothly to look at a point (minimap clicks, jump to a group). */
  focus(x: number, z: number): void {
    this.rig.focus(x, z);
  }

  get cameraTarget(): Point2 & { yaw: number } {
    const state = this.rig.state;
    return { x: state.x, z: state.z, yaw: state.yaw };
  }

  /** Clicks and pointer moves on the map, already resolved to what is under them. */
  onPointer(handler: MapPointerHandler | null): void {
    this.rig.listener = handler
      ? {
          tap: (x, y, button) => handler.tap(this.pick(x, y), button, { x, y }),
          move: (x, y) => {
            const pick = this.pick(x, y);
            this.selection.hover(pick.nodeId, pick.ground);
            handler.hover?.(pick);
          },
        }
      : {};
  }

  setOverlay(overlay: MapOverlay): void {
    this.selection.set(overlay);
    this.rig.edgePan = !overlay.areaRadius && !overlay.buildSites?.length;
  }

  highlightRoute(routeId: string | null): void {
    const index = this.options.level.routes.findIndex((route) => route.id === routeId);
    this.markers.highlight(index >= 0 ? index : null);
  }

  /** How many area effects and closed branches are drawn right now (for tests). */
  get effectMarks(): { areas: number; closures: number } {
    return this.effects.counts;
  }

  /** How many groups carry the hot-seat "hidden" mark right now (for tests). */
  get hiddenMarks(): number {
    return this.entities.hiddenCount;
  }

  /** Where a map point shows on the page (browser tests click the map through this), or null when off screen. */
  screenPoint(x: number, z: number): { x: number; y: number } | null {
    const rect = this.options.canvas.getBoundingClientRect();
    const p = this.projected.set(x, this.world.heightAt(x, z), z).project(this.camera);
    if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
    return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
  }

  /** Finds what is under a screen point. Entities win over nodes, nodes over routes. */
  pick(clientX: number, clientY: number): MapPick {
    const rect = this.options.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const toScreen = (point: THREE.Vector3) => {
      const p = this.projected.copy(point).project(this.camera);
      if (p.z > 1) return Infinity;
      return Math.hypot(((p.x + 1) / 2) * rect.width - sx, ((1 - p.y) / 2) * rect.height - sy);
    };
    const nearest = <T>(items: T[], at: (item: T) => THREE.Vector3, limit: number): T | null => {
      let best: T | null = null;
      let bestDistance = limit;
      for (const item of items) {
        const distance = toScreen(at(item));
        if (distance < bestDistance) {
          best = item;
          bestDistance = distance;
        }
      }
      return best;
    };
    const entityPoint = new THREE.Vector3();
    // Sampled now rather than taken from the last frame, so a slow renderer never hides what just appeared.
    const entities = [...this.buffer.sample(performance.now()).values()];
    const entity = nearest(
      entities,
      (e) => entityPoint.set(e.x, this.world.heightAt(e.x, e.z) + 1, e.z),
      PICK_ENTITY_PX,
    );
    const node = nearest(this.nodePoints, (n) => n.point, PICK_NODE_PX);
    const route = nearest(this.routeSamples, (r) => r.point, PICK_ROUTE_PX);
    this.raycaster.setFromCamera(
      new THREE.Vector2((sx / rect.width) * 2 - 1, -(sy / rect.height) * 2 + 1),
      this.camera,
    );
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    return {
      ground: hit ? { x: hit.point.x, z: hit.point.z } : null,
      entityId: entity?.id ?? null,
      nodeId: node?.id ?? null,
      routeId: route?.routeId ?? null,
    };
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.rig.dispose();
    this.labels.forEach((label) => label.element.remove());
    this.entities.dispose();
    this.selection.dispose();
    this.effects.dispose();
    this.markers.dispose();
    this.world.dispose();
    this.owned.forEach((thing) => thing.dispose());
    this.renderer.dispose();
    if (window.__gtdRenderInfo) delete window.__gtdRenderInfo;
  }

  private own<T extends THREE.Mesh>(mesh: T): T {
    this.owned.push(mesh.geometry, mesh.material as THREE.Material);
    return mesh;
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.options.canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    // Portrait screens see less sideways; widen the view so routes stay in frame.
    this.camera.fov = this.camera.aspect < 1 ? 60 : 45;
    this.camera.updateProjectionMatrix();
  }

  private frame(time: number): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    const elapsed = this.options.reducedMotion ? 0 : time / 1000;
    this.rig.update(dt);

    const view = this.rig.state;
    // Keep the shadow box centred on what the player is looking at.
    this.sun.target.position.set(view.x, 0, view.z);
    this.sun.position.set(view.x - 50, 38, view.z + 10);
    const fog = this.scene.fog as THREE.Fog;
    fog.near = view.distance * 1.6 + 40;
    fog.far = view.distance * 3.5 + 260;

    this.world.update(elapsed);
    this.markers.update(elapsed);
    const now = performance.now();
    this.positions = this.buffer.sample(now);
    this.entities.update(this.buffer.latest, this.positions, elapsed);
    this.effects.update(this.buffer.latest, elapsed);
    const selectedId = this.selection.selectedId;
    const selected = selectedId === null ? undefined : this.positions.get(selectedId);
    const markedId = this.selection.markedId;
    const marked = markedId === null ? undefined : this.positions.get(markedId);
    this.selection.update(time / 1000, selected ?? null, marked ?? null);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.recordStats(now);
  }

  private recordStats(now: number): void {
    const delta = this.lastFrameAt > 0 ? now - this.lastFrameAt : 0;
    this.lastFrameAt = now;
    // Smoothed frame time; works for slow software renderers that draw less than one frame a second too.
    if (delta > 0) this.smoothedMs = this.smoothedMs > 0 ? this.smoothedMs * 0.9 + delta * 0.1 : delta;
    if (now - this.lastStatsAt < 250) return;
    this.lastStatsAt = now;
    const info = this.renderer.info;
    this.stats = {
      preset: this.options.preset.name,
      fps: this.smoothedMs > 0 ? Math.round(1000 / this.smoothedMs) : 0,
      frameMs: Math.round(this.smoothedMs * 10) / 10,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      pixelRatio: this.renderer.getPixelRatio(),
    };
    window.__gtdRenderInfo = this.stats;
    this.options.canvas.dataset.rendered = 'true';
  }

  private createLabels(routes: { id: string; name?: string; path: Point2[] }[]): void {
    const scene = this.options.level.scene;
    const all: WorldLabel[] = [];
    for (const landmark of scene?.landmarks ?? []) {
      if (landmark.label)
        all.push({
          text: this.options.stageText(landmark.label),
          kind: 'landmark',
          x: landmark.x,
          z: landmark.z,
        });
    }
    routes.forEach((route, i) => {
      if (!route.name) return;
      // Name the route where the two routes are furthest apart, around 40% of the way.
      const at = sampleAlong(route.path, pathLength(route.path) * 0.42);
      const color = `#${(ROUTE_COLORS[i % ROUTE_COLORS.length] as number).toString(16).padStart(6, '0')}`;
      all.push({ text: this.options.stageText(route.name), kind: 'route', x: at.x, z: at.z, color });
    });
    for (const label of all) {
      const element = document.createElement('div');
      element.className = `world-label ${label.kind}`;
      element.textContent = label.text;
      if (label.color) element.style.setProperty('--route', label.color);
      element.dataset.testid = `label-${label.kind}`;
      this.options.labelLayer.append(element);
      const lift = label.kind === 'landmark' ? 1.5 : 0.5;
      this.labels.push({
        element,
        position: new THREE.Vector3(label.x, this.world.heightAt(label.x, label.z) + lift, label.z),
        width: element.offsetWidth,
        height: element.offsetHeight,
      });
    }
  }

  private readonly projected = new THREE.Vector3();

  private updateLabels(): void {
    const { clientWidth, clientHeight } = this.options.canvas;
    // Landmarks come first, so when labels would overlap the route name gives way.
    const placed: { left: number; top: number; right: number; bottom: number }[] = [];
    for (const label of this.labels) {
      const p = this.projected.copy(label.position).project(this.camera);
      let visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
      const x = ((p.x + 1) / 2) * clientWidth;
      const y = ((1 - p.y) / 2) * clientHeight;
      const box = { left: x - label.width / 2, top: y - label.height, right: x + label.width / 2, bottom: y };
      if (
        visible &&
        placed.some(
          (o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top,
        )
      ) {
        visible = false;
      }
      label.element.style.visibility = visible ? 'visible' : 'hidden';
      if (!visible) continue;
      placed.push(box);
      label.element.style.transform = `translate(${box.left.toFixed(1)}px, ${box.top.toFixed(1)}px)`;
    }
  }
}

function createSky(): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: SKY_TOP }, horizon: { value: SKY_HORIZON } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 clip = projectionMatrix * viewMatrix * vec4(vWorld + cameraPosition, 1.0);
        gl_Position = clip.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vWorld;
      void main() {
        float h = clamp(normalize(vWorld).y * 1.8, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.7)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
