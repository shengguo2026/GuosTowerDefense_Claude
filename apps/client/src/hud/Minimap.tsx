import type { Level } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import type { MatchSnapshot } from '@gtd/sim';
import { useMemo, type PointerEvent } from 'react';
import { routeColor } from './AttackerPanels';

interface Props {
  level: Level;
  snapshot: MatchSnapshot | null;
  camera: { x: number; z: number } | null;
  selectedId: number | null;
  highContrast: boolean;
  t: Translate;
  onFocus(x: number, z: number): void;
}

const SIZE = 160;

/** A small top-down map: routes, the objective, what the player can see, and where the camera looks. Tap to look there. */
export function Minimap({ level, snapshot, camera, selectedId, highContrast, t, onFocus }: Props) {
  const nodes = useMemo(() => new Map(level.map.nodes.map((n) => [n.id, n])), [level]);
  // Fit the route network with a margin; the terrain around it is scenery.
  const bounds = useMemo(() => {
    const xs = level.map.nodes.map((n) => n.x);
    const zs = level.map.nodes.map((n) => n.z);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) * 1.3 + 16;
    const midX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const midZ = (Math.max(...zs) + Math.min(...zs)) / 2;
    return { minX: midX - span / 2, minZ: midZ - span / 2, span };
  }, [level]);
  const px = (x: number) => ((x - bounds.minX) / bounds.span) * SIZE;
  const pz = (z: number) => ((z - bounds.minZ) / bounds.span) * SIZE;

  const click = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = bounds.minX + ((event.clientX - rect.left) / rect.width) * bounds.span;
    const z = bounds.minZ + ((event.clientY - rect.top) / rect.height) * bounds.span;
    onFocus(x, z);
  };

  return (
    <nav className="hud-panel minimap" aria-label={t('hud.minimap')} data-tutorial="minimap">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={t('hud.minimapTip')}
        onPointerDown={click}
        data-testid="minimap"
      >
        <rect width={SIZE} height={SIZE} className="minimap-ground" />
        {level.routes.map((route) => (
          <polyline
            key={route.id}
            points={route.nodes
              .map((id) => nodes.get(id))
              .filter((n) => n !== undefined)
              .map((n) => `${px(n.x)},${pz(n.z)}`)
              .join(' ')}
            fill="none"
            stroke={routeColor(level, route.id)}
            strokeWidth={highContrast ? 4 : 2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.85}
          />
        ))}
        {snapshot && (
          <circle
            cx={px(snapshot.objective.x)}
            cy={pz(snapshot.objective.z)}
            r={6}
            className={`minimap-objective ${snapshot.objective.contested ? 'contested' : ''}`}
          />
        )}
        {snapshot?.entities.map((entity) =>
          entity.kind === 'group' ? (
            <circle
              key={entity.id}
              cx={px(entity.x)}
              cy={pz(entity.z)}
              r={entity.id === selectedId ? 4.5 : 3}
              className={`minimap-group ${entity.id === selectedId ? 'selected' : ''}`}
            />
          ) : (
            <rect
              key={entity.id}
              x={px(entity.x) - 3}
              y={pz(entity.z) - 3}
              width={6}
              height={6}
              className={`minimap-defense ${entity.remembered ? 'remembered' : ''} ${entity.id === selectedId ? 'selected' : ''}`}
            />
          ),
        )}
        {camera && (
          <rect
            x={px(camera.x) - 22}
            y={pz(camera.z) - 15}
            width={44}
            height={30}
            className="minimap-camera"
          />
        )}
      </svg>
    </nav>
  );
}
