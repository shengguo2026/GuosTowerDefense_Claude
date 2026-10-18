import * as THREE from 'three';

export interface WorldView {
  dispose(): void;
}

const SKY_TOP = new THREE.Color('#4f86d6');
const SKY_HORIZON = new THREE.Color('#f6c98a');
const GROUND = new THREE.Color('#c9a25a');
const HILLS = ['#8a6fa0', '#9b7aa6', '#b48aa3'];

/**
 * The empty 3D world of the foundation build: sky gradient, warm key light with a cool rim light, a gently uneven
 * low-poly ground and layered distant hills, in the style of the approved sample. Levels are added from M1 on.
 */
export function createWorldView(canvas: HTMLCanvasElement): WorldView {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_HORIZON, 120, 380);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.5, 600);

  scene.add(createSky());
  scene.add(createGround());
  scene.add(createHills());

  scene.add(new THREE.HemisphereLight('#bcd4ff', '#8a6a3a', 0.9));
  const key = new THREE.DirectionalLight('#ffd9a0', 2.4);
  key.position.set(-60, 70, 40);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -60;
  key.shadow.camera.right = 60;
  key.shadow.camera.top = 60;
  key.shadow.camera.bottom = -60;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#8fb4ff', 0.8);
  rim.position.set(50, 30, -60);
  scene.add(rim);

  const resize = () => {
    const { clientWidth, clientHeight } = canvas;
    if (clientWidth === 0 || clientHeight === 0) return;
    renderer.setSize(clientWidth, clientHeight, false);
    camera.aspect = clientWidth / clientHeight;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frames = 0;
  renderer.setAnimationLoop((time: number) => {
    const angle = reducedMotion ? 0.6 : 0.6 + time * 0.00002;
    camera.position.set(Math.sin(angle) * 80, 26, Math.cos(angle) * 80);
    camera.lookAt(0, 10, 0);
    renderer.render(scene, camera);
    frames++;
    // Lets automated tests confirm the scene really renders.
    if (frames === 2) canvas.dataset.rendered = 'true';
  });

  return {
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
    },
  };
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
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top;
      uniform vec3 horizon;
      varying vec3 vWorld;
      void main() {
        float h = clamp(normalize(vWorld).y * 2.2, 0.0, 1.0);
        gl_FragColor = vec4(mix(horizon, top, pow(h, 0.8)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), material);
}

/** Cheap, stable value noise so the ground looks the same on every launch. */
function noise(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function createGround(): THREE.Mesh {
  const grid = new THREE.PlaneGeometry(700, 700, 70, 70);
  grid.rotateX(-Math.PI / 2);
  const gridPositions = grid.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < gridPositions.count; i++) {
    gridPositions.setY(i, (noise(gridPositions.getX(i), gridPositions.getZ(i)) - 0.5) * 0.5);
  }
  // Separate triangles so each face gets its own shade, the low-poly look of the approved sample.
  const geometry = grid.toNonIndexed();
  grid.dispose();
  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const color = new THREE.Color();
  for (let face = 0; face < positions.count; face += 3) {
    color.copy(GROUND).offsetHSL(0, 0, (noise(positions.getZ(face), positions.getX(face)) - 0.5) * 0.035);
    for (let corner = 0; corner < 3; corner++) colors.set([color.r, color.g, color.b], (face + corner) * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
  );
  mesh.receiveShadow = true;
  return mesh;
}

function createHills(): THREE.Group {
  const hills = new THREE.Group();
  for (let ring = 0; ring < 3; ring++) {
    const material = new THREE.MeshStandardMaterial({ color: HILLS[ring], flatShading: true, roughness: 1 });
    const count = 10 + ring * 3;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + ring * 0.41;
      const radius = 200 + ring * 45 + noise(i, ring) * 25;
      const height = 7 + noise(ring, i) * 10 + ring * 6;
      const width = 45 + noise(i, i + ring) * 35;
      // Wide, flat seven-sided cones read as distant table hills rather than pyramids.
      const hill = new THREE.Mesh(new THREE.ConeGeometry(width, height, 7, 1), material);
      hill.scale.z = 0.6 + noise(i + 1, ring) * 0.5;
      hill.position.set(Math.cos(angle) * radius, height / 2 - 1, Math.sin(angle) * radius);
      hill.rotation.y = noise(i + 3, ring) * Math.PI;
      hills.add(hill);
    }
  }
  return hills;
}
