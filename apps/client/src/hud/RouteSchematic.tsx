import type { Level } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import type { GroupEntity } from '@gtd/sim';
import { useMemo } from 'react';
import { cursorNodes, junctionIds } from '../match/schematic';
import { routeColor } from './AttackerPanels';
import { KeyHint } from './KeyHint';

const WIDTH = 300;
const HEIGHT = 190;
const MARGIN = 18;

/** A map node's name: the landmark standing on it, else what kind of node it is. */
export function placeName(level: Level, stageText: Translate, t: Translate, nodeId: string): string {
  const landmark = level.scene?.landmarks.find((l) => l.id === nodeId);
  if (landmark?.label) return stageText(landmark.label);
  const node = level.map.nodes.find((n) => n.id === nodeId);
  return t(`node.kind.${node?.kind ?? 'connector'}`);
}

interface Props {
  level: Level;
  groups: GroupEntity[];
  cursor: string;
  /** The route of the group being built, drawn stronger. */
  draftRoute: string | null;
  selectedId: number | null;
  /** What the next T Z U or Enter press does, in words. */
  help: string;
  highContrast: boolean;
  t: Translate;
  stageText: Translate;
}

/**
 * The hot-seat Attacker's map (spec §5.2): the route graph as a clean 2D schematic with a junction cursor moved by
 * W A S D, so the keyboard player never needs the shared camera. Drawn like the minimap: x to the right, z downwards.
 */
export function RouteSchematic({
  level,
  groups,
  cursor,
  draftRoute,
  selectedId,
  help,
  highContrast,
  t,
  stageText,
}: Props) {
  const nodes = useMemo(() => cursorNodes(level), [level]);
  const junctions = useMemo(() => junctionIds(level), [level]);
  const byId = useMemo(() => new Map(level.map.nodes.map((n) => [n.id, n])), [level]);
  const frame = useMemo(() => {
    const xs = nodes.map((n) => n.x);
    const zs = nodes.map((n) => n.z);
    const minX = Math.min(...xs);
    const minZ = Math.min(...zs);
    const scale = Math.min(
      (WIDTH - MARGIN * 2) / Math.max(1, Math.max(...xs) - minX),
      (HEIGHT - MARGIN * 2) / Math.max(1, Math.max(...zs) - minZ),
    );
    // Centre the drawing in the box.
    const offX = (WIDTH - (Math.max(...xs) - minX) * scale) / 2;
    const offZ = (HEIGHT - (Math.max(...zs) - minZ) * scale) / 2;
    return { px: (x: number) => offX + (x - minX) * scale, pz: (z: number) => offZ + (z - minZ) * scale };
  }, [nodes]);
  const at = byId.get(cursor);

  return (
    <section className="hud-panel schematic" aria-label={t('hot.schematic')} data-testid="schematic">
      <h3>
        {t('hot.schematic')}
        <span className="keys" aria-hidden="true">
          <KeyHint action="cursor.up" />
          <KeyHint action="cursor.left" />
          <KeyHint action="cursor.down" />
          <KeyHint action="cursor.right" />
        </span>
      </h3>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t('hot.schematicTip')}>
        {level.routes.map((route) => (
          <polyline
            key={route.id}
            points={route.nodes
              .map((id) => byId.get(id))
              .filter((n) => n !== undefined)
              .map((n) => `${frame.px(n.x)},${frame.pz(n.z)}`)
              .join(' ')}
            fill="none"
            stroke={routeColor(level, route.id)}
            strokeWidth={route.id === draftRoute ? 7 : highContrast ? 5 : 3.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={route.id === draftRoute ? 1 : 0.7}
          />
        ))}
        {nodes.map((node) => (
          <g
            key={node.id}
            className={`schematic-node ${node.kind ?? ''} ${junctions.has(node.id) ? 'junction' : ''}`}
          >
            {node.kind === 'objective' ? (
              <circle cx={frame.px(node.x)} cy={frame.pz(node.z)} r={9} />
            ) : junctions.has(node.id) ? (
              <rect x={frame.px(node.x) - 6} y={frame.pz(node.z) - 6} width={12} height={12} rx={2} />
            ) : (
              <circle cx={frame.px(node.x)} cy={frame.pz(node.z)} r={5} />
            )}
          </g>
        ))}
        {groups.map((group) => (
          <circle
            key={group.id}
            cx={frame.px(group.x)}
            cy={frame.pz(group.z)}
            r={group.id === selectedId ? 6 : 4.5}
            className={`schematic-group ${group.id === selectedId ? 'selected' : ''} ${group.detection === 'unknown' ? 'hidden' : ''}`}
            data-testid="schematic-group"
          />
        ))}
        {at && (
          <circle
            cx={frame.px(at.x)}
            cy={frame.pz(at.z)}
            r={14}
            className="schematic-cursor"
            data-testid="schematic-cursor"
            data-node={cursor}
          />
        )}
      </svg>
      <p className="schematic-at" data-testid="cursor-node">
        <strong>{placeName(level, stageText, t, cursor)}</strong>
        <span className="muted"> · {help}</span>
      </p>
    </section>
  );
}
