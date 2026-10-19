import type { Level, StagePack } from '@gtd/content-schema';
import type { WaveGroupOrder } from '@gtd/sim';
import { useCallback, useState } from 'react';
import { FORMATIONS, MAX_DRAFT_GROUPS } from '../hud/AttackerPanels';

const MAX_COUNT = 99;

/** The Attacker's next wave while it is being built: up to four groups, one of them being edited. */
export function useWaveDrafts(units: StagePack['catalog']['units'], level: Level | undefined) {
  const [drafts, setDrafts] = useState<WaveGroupOrder[]>(() => [
    {
      unitTypeId: units[0]?.id ?? '',
      count: 6,
      formation: 'column',
      routeId: level?.routes[0]?.id ?? '',
      delaySeconds: 0,
    },
  ]);
  const [current, setCurrent] = useState(0);
  const index = Math.min(current, drafts.length - 1);

  const update = useCallback(
    (at: number, patch: Partial<WaveGroupOrder>) =>
      setDrafts((list) => list.map((d, i) => (i === at ? { ...d, ...patch } : d))),
    [],
  );
  const add = useCallback(() => {
    setDrafts((list) => {
      if (list.length >= MAX_DRAFT_GROUPS) return list;
      const next = [...list, { ...(list[list.length - 1] as WaveGroupOrder) }];
      setCurrent(next.length - 1);
      return next;
    });
  }, []);
  const remove = useCallback((at: number) => {
    setDrafts((list) => (list.length > 1 ? list.filter((_, i) => i !== at) : list));
    setCurrent(0);
  }, []);

  /**
   * Unit key 1–4: picks that unit for the group being built; pressed again it adds one member, with Shift it takes
   * one away (spec §5.2).
   */
  const unitKey = useCallback(
    (unitId: string, remove: boolean) =>
      setDrafts((list) =>
        list.map((d, i) => {
          if (i !== index) return d;
          if (d.unitTypeId !== unitId) return remove ? d : { ...d, unitTypeId: unitId };
          return { ...d, count: Math.min(MAX_COUNT, Math.max(1, d.count + (remove ? -1 : 1))) };
        }),
      ),
    [index],
  );
  const cycleFormation = useCallback(
    () =>
      setDrafts((list) =>
        list.map((d, i) =>
          i === index
            ? {
                ...d,
                formation:
                  FORMATIONS[(FORMATIONS.indexOf(d.formation) + 1) % FORMATIONS.length] ?? d.formation,
              }
            : d,
        ),
      ),
    [index],
  );

  return { drafts, current: index, setCurrent, update, add, remove, unitKey, cycleFormation };
}
