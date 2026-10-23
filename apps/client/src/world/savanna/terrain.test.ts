import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { PRESETS } from '../presets';
import { createGround, createHeightField, surfaceHeightField } from './terrain';

describe('surfaceHeightField', () => {
  it('matches the rendered ground mesh, including inside carved tracks', () => {
    const input = {
      size: 120,
      landmarks: [],
      streambed: [
        { x: -50, z: 10 },
        { x: 40, z: -5 },
      ],
      tracks: [
        [
          { x: -40, z: -30 },
          { x: 30, z: 25 },
        ],
      ],
    };
    const smooth = createHeightField(input);
    const blank = new THREE.Texture();
    const ground = createGround(
      input,
      smooth,
      { grass: blank, dirt: blank, riverbed: blank, mud: blank },
      PRESETS.low,
    );
    const surface = surfaceHeightField(smooth, input.size, PRESETS.low.terrainSegments);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    for (const [x, z] of [
      [0.3, 0.7],
      [-20.4, -14.9],
      [10.1, 2.2],
      [33.3, -3.7],
      [-44.2, 9.6],
    ] as const) {
      ray.set(new THREE.Vector3(x, 100, z), down);
      const hit = ray.intersectObject(ground)[0];
      expect(hit, `${x},${z}`).toBeDefined();
      expect(surface(x, z)).toBeCloseTo(hit!.point.y, 3);
    }
  });
});
