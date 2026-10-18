import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Collects many small coloured shapes into one geometry with per-vertex colours, so a whole forest or a whole
 * figure renders in a single draw call with one shared flat-shaded material.
 */
export class ColorGeometryBuilder {
  private readonly parts: THREE.BufferGeometry[] = [];

  /** Adds a shape in one colour. The shape is copied; the original can be reused. */
  add(shape: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4): this {
    const part = prepare(shape);
    if (matrix) part.applyMatrix4(matrix);
    const c = new THREE.Color(color);
    const colors = new Float32Array(part.attributes.position!.count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([c.r, c.g, c.b], i);
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.parts.push(part);
    return this;
  }

  /** Adds an already coloured geometry (e.g. a finished model) at a position. */
  addColored(model: THREE.BufferGeometry, matrix: THREE.Matrix4): this {
    const part = model.clone();
    part.applyMatrix4(matrix);
    this.parts.push(part);
    return this;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  build(): THREE.BufferGeometry {
    if (this.parts.length === 0) return new THREE.BufferGeometry();
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((part) => part.dispose());
    this.parts.length = 0;
    if (!merged) throw new Error('Could not merge geometries');
    merged.computeBoundingSphere();
    return merged;
  }
}

function prepare(shape: THREE.BufferGeometry): THREE.BufferGeometry {
  const part = shape.index ? shape.toNonIndexed() : shape.clone();
  for (const name of Object.keys(part.attributes)) {
    if (name !== 'position' && name !== 'normal') part.deleteAttribute(name);
  }
  if (!part.attributes.normal) part.computeVertexNormals();
  return part;
}

const scratch = new THREE.Object3D();

/** Builds a transform matrix from position, rotation (radians) and scale. */
export function transform(
  x: number,
  y: number,
  z: number,
  rotation: [number, number, number] = [0, 0, 0],
  scale: number | [number, number, number] = 1,
): THREE.Matrix4 {
  scratch.position.set(x, y, z);
  scratch.rotation.set(rotation[0], rotation[1], rotation[2]);
  if (typeof scale === 'number') scratch.scale.setScalar(scale);
  else scratch.scale.set(scale[0], scale[1], scale[2]);
  scratch.updateMatrix();
  return scratch.matrix.clone();
}

/** Shared material for every vertex-coloured, flat-shaded model. */
export function createFlatMaterial(
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    roughness: 0.9,
    ...options,
  });
}
