import * as THREE from 'three';
import { distanceToPath, type Point2 } from '../paths';
import type { PresetSettings } from '../presets';

export interface Landmark {
  id: string;
  kind: string;
  x: number;
  z: number;
  radius: number;
  rotation: number;
}

export interface TerrainInput {
  size: number;
  landmarks: Landmark[];
  /** Path of the dry streambed, carved into the ground. */
  streambed: Point2[] | null;
  /** Other route paths, drawn as worn dirt tracks. */
  tracks: Point2[][];
}

export type HeightAt = (x: number, z: number) => number;

/** Smooth, cheap rolling noise; deterministic so terrain and props always agree. */
export function rolling(x: number, z: number): number {
  return Math.sin(x * 0.11 + Math.cos(z * 0.07) * 2) * 0.5 + Math.sin(z * 0.13 + x * 0.05) * 0.5;
}

export function createHeightField(input: TerrainInput): HeightAt {
  const ridges = input.landmarks.filter((l) => l.kind === 'rockyRidge');
  const waterholes = input.landmarks.filter((l) => l.kind === 'waterhole');
  const rimStart = input.size * 0.3;
  return (x, z) => {
    let h = rolling(x, z) * 0.9;
    for (const ridge of ridges) h += Math.max(0, ridge.radius - Math.hypot(x - ridge.x, z - ridge.z)) * 0.5;
    if (input.streambed) {
      const d = distanceToPath(x, z, input.streambed);
      if (d < 4.5) h -= (4.5 - d) * 0.35;
    }
    for (const hole of waterholes) {
      const d = Math.hypot(x - hole.x, z - hole.z);
      if (d < hole.radius + 2) h -= (hole.radius + 2 - d) * 0.22;
    }
    // The land rises towards the edges, framing the play area.
    const edge = Math.max(Math.abs(x), Math.abs(z)) - rimStart;
    if (edge > 0) h += edge * edge * 0.006;
    return h;
  };
}

export interface GroundTextures {
  grass: THREE.Texture;
  dirt: THREE.Texture;
  riverbed: THREE.Texture;
}

const GRASS_TINT = new THREE.Color(1, 1, 1);
const DRY_TINT = new THREE.Color(0.93, 0.9, 0.82);
const GREEN_TINT = new THREE.Color(0.82, 0.95, 0.66);

function groundVertexHeight(heightAt: HeightAt, x: number, z: number): number {
  return heightAt(x, z) + jitter(x, z) * 0.06;
}

/**
 * Height of the faceted ground mesh itself, triangle by triangle. The smooth height field and the mesh differ inside
 * each triangle (most in carved tracks), so anything that must sit exactly on the surface (markers, figures, props)
 * uses this instead.
 */
export function surfaceHeightField(heightAt: HeightAt, size: number, segments: number): HeightAt {
  const step = size / segments;
  const half = size / 2;
  const row = segments + 1;
  const heights = new Float32Array(row * row);
  for (let iz = 0; iz <= segments; iz++) {
    for (let ix = 0; ix <= segments; ix++) {
      heights[iz * row + ix] = groundVertexHeight(heightAt, ix * step - half, iz * step - half);
    }
  }
  return (x, z) => {
    const fx = Math.min(Math.max((x + half) / step, 0), segments - 1e-6);
    const fz = Math.min(Math.max((z + half) / step, 0), segments - 1e-6);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const u = fx - ix;
    const v = fz - iz;
    const h00 = heights[iz * row + ix] as number;
    const h10 = heights[iz * row + ix + 1] as number;
    const h01 = heights[(iz + 1) * row + ix] as number;
    const h11 = heights[(iz + 1) * row + ix + 1] as number;
    // PlaneGeometry splits each cell along the diagonal from (0,1) to (1,0).
    if (u + v <= 1) return h00 + u * (h10 - h00) + v * (h01 - h00);
    return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
  };
}

/**
 * Low-poly ground: every triangle gets one blend of the three Codex ground textures (grass, dirt track, riverbed)
 * and a slight tint, so the surface keeps the faceted look of the approved sample while carrying texture detail.
 */
export function createGround(
  input: TerrainInput,
  heightAt: HeightAt,
  textures: GroundTextures,
  preset: PresetSettings,
): THREE.Mesh {
  const grid = new THREE.PlaneGeometry(
    input.size,
    input.size,
    preset.terrainSegments,
    preset.terrainSegments,
  );
  grid.rotateX(-Math.PI / 2);
  const gridPositions = grid.attributes.position as THREE.BufferAttribute;
  // Heights come from the grid indices rather than the stored float32 positions, so surfaceHeightField can
  // reproduce them exactly (the jitter hash is sensitive to the last bits of its input).
  const row = preset.terrainSegments + 1;
  const step = input.size / preset.terrainSegments;
  for (let i = 0; i < gridPositions.count; i++) {
    const x = (i % row) * step - input.size / 2;
    const z = Math.floor(i / row) * step - input.size / 2;
    gridPositions.setY(i, groundVertexHeight(heightAt, x, z));
  }
  const geometry = grid.toNonIndexed();
  grid.dispose();
  geometry.deleteAttribute('uv');

  const positions = geometry.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(positions.count * 3);
  const splat = new Float32Array(positions.count * 3);
  const waterholes = input.landmarks.filter((l) => l.kind === 'waterhole');
  const tint = new THREE.Color();
  for (let i = 0; i < positions.count; i += 3) {
    const x = (positions.getX(i) + positions.getX(i + 1) + positions.getX(i + 2)) / 3;
    const z = (positions.getZ(i) + positions.getZ(i + 1) + positions.getZ(i + 2)) / 3;
    const patch = (rolling(x * 2.3, z * 2.1) + 1) / 2;
    tint.copy(GRASS_TINT).lerp(DRY_TINT, patch * 0.7);
    if (patch > 0.8) tint.lerp(GREEN_TINT, 0.45);
    for (const hole of waterholes) {
      if (Math.hypot(x - hole.x, z - hole.z) < hole.radius + 4) tint.lerp(GREEN_TINT, 0.55);
    }
    tint.offsetHSL(0, 0, jitter(z, x) * 0.03);

    const track = Math.min(...input.tracks.map((p) => distanceToPath(x, z, p)), Infinity);
    const stream = input.streambed ? distanceToPath(x, z, input.streambed) : Infinity;
    const dirt = clamp01((3 - track) / 1.3);
    const river = clamp01((3.8 - stream) / 1.5);
    const grass = Math.max(0, 1 - dirt - river);
    const sum = grass + dirt + river;
    for (let k = 0; k < 3; k++) {
      colors.set([tint.r, tint.g, tint.b], (i + k) * 3);
      splat.set([grass / sum, dirt / sum, river / sum], (i + k) * 3);
    }
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 1,
    envMapIntensity: 0.2,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: textures.grass };
    shader.uniforms.tDirt = { value: textures.dirt };
    shader.uniforms.tRiver = { value: textures.riverbed };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 splat;\nvarying vec3 vSplat;\nvarying vec2 vGroundUv;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvSplat = splat;\nvGroundUv = (modelMatrix * vec4(position, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tGrass;\nuniform sampler2D tDirt;\nuniform sampler2D tRiver;\nvarying vec3 vSplat;\nvarying vec2 vGroundUv;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Two scales of the same tile, rotated against each other, hide the repeat.
        vec2 uvA = vGroundUv / 14.0;
        vec2 uvB = mat2(0.8, -0.6, 0.6, 0.8) * vGroundUv / 37.0;
        vec3 ground = vSplat.x * mix(texture2D(tGrass, uvA).rgb, texture2D(tGrass, uvB).rgb, 0.45)
                    + vSplat.y * mix(texture2D(tDirt, uvA).rgb, texture2D(tDirt, uvB).rgb, 0.35)
                    + vSplat.z * texture2D(tRiver, uvA * 1.3).rgb * vec3(0.74, 0.6, 0.47);
        diffuseColor.rgb *= ground * 1.08;`,
      );
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return mesh;
}

/** Repeatable pseudo-random value in [-1, 1] for a position. */
export function jitter(x: number, z: number): number {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Loads a repeating ground texture; until it arrives (or if it is missing), a flat colour of the same tone is used. */
export function loadGroundTexture(
  url: string,
  fallback: THREE.ColorRepresentation,
  anisotropy: number,
): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = `#${new THREE.Color(fallback).getHexString()}`;
    context.fillRect(0, 0, 4, 4);
  }
  const texture = new THREE.Texture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  new THREE.ImageLoader().load(url, (image) => {
    texture.image = image;
    texture.needsUpdate = true;
  });
  return texture;
}
