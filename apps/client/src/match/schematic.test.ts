import type { Level } from '@gtd/content-schema';
import type { GroupEntity } from '@gtd/sim';
import { describe, expect, it } from 'vitest';
import { cursorNodes, holdAtCursor, moveCursor, rerouteAtCursor, startCursor } from './schematic';

// Lion's shape: spawn bottom left, one junction, two branches, the waterhole top right.
const level = {
  map: {
    nodes: [
      { id: 'spawn', kind: 'spawn', x: -58, z: 36 },
      { id: 'junction', kind: 'junction', x: -36, z: 29 },
      { id: 'ridge', kind: 'checkpoint', x: -9, z: 9 },
      { id: 'river', kind: 'checkpoint', x: -13, z: 27 },
      { id: 'goal', kind: 'objective', x: 12, z: -8 },
      { id: 'zone', kind: 'buildZone', x: -30, z: 19, buildable: true },
    ],
  },
  routes: [
    { id: 'ridge', nodes: ['spawn', 'junction', 'ridge', 'goal'] },
    { id: 'riverbed', nodes: ['spawn', 'junction', 'river', 'goal'] },
  ],
} as unknown as Level;

const group = (patch: Partial<GroupEntity>): GroupEntity =>
  ({ id: 1, kind: 'group', routeId: 'ridge', leg: 0, state: 'moving', ...patch }) as GroupEntity;

describe('junction cursor on the route schematic', () => {
  it('stands only on route nodes and starts on the first junction', () => {
    expect(cursorNodes(level).map((n) => n.id)).not.toContain('zone');
    expect(startCursor(level)).toBe('junction');
  });

  it('moves to the closest node in the pressed direction and stays put at the edge', () => {
    expect(moveCursor(level, 'junction', 'left')).toBe('spawn');
    expect(moveCursor(level, 'junction', 'right')).toBe('river');
    expect(moveCursor(level, 'river', 'up')).toBe('ridge');
    expect(moveCursor(level, 'ridge', 'up')).toBe('goal');
    expect(moveCursor(level, 'goal', 'up')).toBe('goal');
    expect(moveCursor(level, 'spawn', 'left')).toBe('spawn');
  });

  it('holds a field group at the cursor junction only when it lies ahead', () => {
    expect(holdAtCursor(level, group({ leg: 0 }), 'junction')).toEqual({ type: 'hold', nodeId: 'junction' });
    expect(holdAtCursor(level, group({ leg: 1 }), 'junction')).toMatchObject({ reason: 'notAhead' });
    expect(holdAtCursor(level, group({ leg: 0 }), 'ridge')).toMatchObject({ reason: 'notJunction' });
  });

  it('reroutes a holding group at once and a moving one at the cursor node ahead', () => {
    expect(rerouteAtCursor(level, group({ state: 'holding', leg: 1 }), 'goal', 'riverbed')).toEqual({
      type: 'rerouteNow',
      routeId: 'riverbed',
    });
    expect(rerouteAtCursor(level, group({ leg: 0 }), 'junction', 'riverbed')).toEqual({
      type: 'switch',
      nodeId: 'junction',
      routeId: 'riverbed',
    });
    expect(rerouteAtCursor(level, group({ leg: 0 }), 'ridge', 'riverbed')).toMatchObject({
      reason: 'routeMissesNode',
    });
    expect(rerouteAtCursor(level, group({ leg: 1 }), 'junction', 'riverbed')).toMatchObject({
      reason: 'notAhead',
    });
    expect(rerouteAtCursor(level, group({}), 'junction', 'ridge')).toMatchObject({ reason: 'sameRoute' });
  });
});
