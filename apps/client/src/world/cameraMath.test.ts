import { describe, expect, it } from 'vitest';
import {
  blendCamera,
  cameraPosition,
  clampCamera,
  panByScreen,
  panByWorld,
  type CameraState,
} from './cameraMath';

const limits = { minPitch: 0.5, maxPitch: 1.2, minDistance: 20, maxDistance: 150, bounds: 100 };
const base: CameraState = { x: 0, z: 0, yaw: 0, pitch: 0.8, distance: 60 };

describe('camera math', () => {
  it('keeps angle, distance and look-at point inside the limits', () => {
    expect(clampCamera({ x: 500, z: -500, yaw: 7, pitch: 0.1, distance: 5 }, limits)).toEqual({
      x: 100,
      z: -100,
      yaw: expect.closeTo(7 - 2 * Math.PI, 5),
      pitch: 0.5,
      distance: 20,
    });
  });

  it('places the camera behind and above the look-at point', () => {
    const p = cameraPosition(base);
    expect(p.z).toBeGreaterThan(0);
    expect(p.y).toBeCloseTo(Math.sin(0.8) * 60);
    expect(p.x).toBeCloseTo(0);
  });

  it('drags the ground with the pointer', () => {
    // With yaw 0 the camera looks towards -z: dragging right shows ground further left, dragging down shows ground further ahead.
    const right = panByScreen(base, 100, 0, 800, 0.7);
    expect(right.x).toBeLessThan(0);
    const down = panByScreen(base, 0, 100, 800, 0.7);
    expect(down.z).toBeLessThan(0);
  });

  it('pans along the camera axes', () => {
    const turned = { ...base, yaw: Math.PI / 2 };
    const moved = panByWorld(turned, 0, 10);
    expect(moved.x).toBeCloseTo(-10);
    expect(moved.z).toBeCloseTo(0);
  });

  it('blends yaw the short way round', () => {
    const blended = blendCamera({ ...base, yaw: 3 }, { ...base, yaw: -3 }, 0.5);
    expect(Math.abs(blended.yaw)).toBeGreaterThan(3);
  });
});
