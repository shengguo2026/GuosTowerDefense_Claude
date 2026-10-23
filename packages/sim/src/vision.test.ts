import { describe, expect, it } from 'vitest';
import { VisionField, segmentsIntersect, type VisionArea } from './vision';

const area = (overrides: Partial<VisionArea> & Pick<VisionArea, 'id'>): VisionArea => ({
  kind: 'test',
  los: 'none',
  cover: 1,
  exposure: 1,
  vantage: 1,
  ...overrides,
});

describe('VisionField', () => {
  const field = new VisionField([
    area({
      id: 'wall',
      los: 'blocker',
      wall: {
        points: [
          { x: 0, z: -5 },
          { x: 0, z: 5 },
        ],
        width: 2,
      },
    }),
    area({ id: 'brush', los: 'partial', cover: 0.5, circle: { x: 10, z: 10, radius: 3 }, exposure: 0.8 }),
    area({ id: 'ledge', vantage: 1.5, circle: { x: -10, z: 10, radius: 2 } }),
    area({ id: 'boulder', los: 'blocker', circle: { x: 20, z: 0, radius: 2 } }),
  ]);

  it('stops sight lines at a wall and around it sees freely', () => {
    expect(field.lineFactor({ x: -3, z: 0 }, { x: 3, z: 0 })).toBe(0);
    expect(field.blocked({ x: -3, z: 0 }, { x: 3, z: 0 })).toBe(true);
    expect(field.lineFactor({ x: -3, z: 8 }, { x: 3, z: 8 })).toBe(1);
    expect(field.sees({ x: -3, z: 8 }, { x: 3, z: 8 }, 10)).toBe(true);
    expect(field.sees({ x: -3, z: 0 }, { x: 3, z: 0 }, 10)).toBe(false);
  });

  it('shortens sight lines through brush, also when one end stands in it', () => {
    expect(field.lineFactor({ x: 5, z: 10 }, { x: 15, z: 10 })).toBe(0.5);
    expect(field.lineFactor({ x: 5, z: 10 }, { x: 10, z: 10 })).toBe(0.5);
    expect(field.sees({ x: 5, z: 10 }, { x: 10, z: 10 }, 8)).toBe(false);
    expect(field.sees({ x: 5, z: 10 }, { x: 10, z: 10 }, 12)).toBe(true);
  });

  it('gives exposure and vantage to whoever stands in an area', () => {
    expect(field.exposureAt({ x: 10, z: 11 })).toBe(0.8);
    expect(field.exposureAt({ x: 30, z: 30 })).toBe(1);
    expect(field.vantageAt({ x: -10, z: 9 })).toBe(1.5);
    expect(field.vantageAt({ x: 0, z: 20 })).toBe(1);
  });

  it('lets someone standing on a boulder see out, while it blocks lines past it', () => {
    expect(field.blocked({ x: 15, z: 0 }, { x: 25, z: 0 })).toBe(true);
    expect(field.blocked({ x: 20, z: 1 }, { x: 25, z: 0 })).toBe(false);
  });

  it('draws a view area that stops at the wall', () => {
    const shape = field.viewShape({ x: -4, z: 0 }, 10, 4);
    // Rays: east (into the wall), south, west, north.
    expect(shape[0]!.x).toBeLessThan(0);
    expect(shape[2]!.x).toBeCloseTo(-14);
  });

  it('intersects segments, touching included', () => {
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 2, z: 2 }, { x: 0, z: 2 }, { x: 2, z: 0 })).toBe(true);
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 5 })).toBe(true);
    expect(segmentsIntersect({ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 5 })).toBe(false);
  });
});
