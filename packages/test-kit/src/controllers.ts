import type { Controller } from '@gtd/ai';
import type { Formation } from '@gtd/sim';

export { idleController, type Controller } from '@gtd/ai';

export interface ScriptedAttackerOptions {
  /** Cycle through every unit type instead of always taking the cheapest. */
  mixUnits?: boolean;
  formation?: Formation;
  /** Only use this route instead of cycling through all of them. */
  routeId?: string;
  /** Groups per wave (each of `groupSize` members); the wave waits until all of them can be paid for. */
  groupsPerWave?: number;
}

/** Launches a one-group wave whenever the rules allow it and it can pay, cycling through the routes. */
export function scriptedAttacker(
  groupSize = 1,
  everyTicks = 40,
  options: ScriptedAttackerOptions = {},
): Controller {
  let routeIndex = 0;
  let unitIndex = 0;
  return {
    decide(snapshot, setup) {
      if (snapshot.phase !== 'combat' || snapshot.tick % everyTicks !== 1) return [];
      if (snapshot.launchCooldownRemainingTicks > 0 || snapshot.activeWaves >= setup.level.maxActiveWaves)
        return [];
      const units = [...setup.attacker.units].sort((a, b) => a.cost - b.cost);
      const unit = options.mixUnits ? units[unitIndex % units.length] : units[0];
      if (!unit) return [];
      const groups = options.groupsPerWave ?? 1;
      const count = Math.min(groupSize, Math.floor(snapshot.capacity.remaining / unit.capacity / groups));
      if (count < 1 || unit.cost * count * groups > (snapshot.resources.attacker ?? 0)) return [];
      unitIndex++;
      const routeId = options.routeId ?? setup.level.routes[routeIndex++ % setup.level.routes.length]?.id;
      if (!routeId) return [];
      const formation = options.formation ?? 'column';
      return [
        {
          type: 'launchWave',
          side: 'attacker',
          tick: snapshot.tick,
          groups: Array.from({ length: groups }, () => ({
            unitTypeId: unit.id,
            count,
            formation,
            routeId,
            delaySeconds: 0,
          })),
        },
      ];
    },
  };
}

export interface ScriptedDefenderOptions {
  /** Stop building after this many defenses. */
  maxDefenses?: number;
  /** Earliest tick for the first build. */
  startTick?: number;
  /** Only build these defense types (default: all of the profile's). */
  defenseTypeIds?: string[];
}

/**
 * Builds whenever it can afford to, alternating defense types: structures on free build zones, mobile assets on the
 * objective, which they then guard.
 */
export function scriptedDefender(options: ScriptedDefenderOptions = {}): Controller {
  const { maxDefenses = Infinity, startTick = 0 } = options;
  return {
    decide(snapshot, setup) {
      if (snapshot.tick < startTick || snapshot.phase === 'ended') return [];
      const built = snapshot.entities.flatMap((e) => (e.kind === 'defense' ? [e] : []));
      if (built.length >= maxDefenses) return [];
      const defenses = setup.defender.defenses.filter(
        (d) => !options.defenseTypeIds || options.defenseTypeIds.includes(d.id),
      );
      const defense = defenses[built.length % Math.max(1, defenses.length)];
      if (!defense || defense.cost > (snapshot.resources.defender ?? 0)) return [];
      let nodeId: string | undefined;
      if (defense.mobile) nodeId = setup.level.objective.nodeId;
      else {
        const taken = new Set(built.filter((d) => !d.mobile).map((d) => d.nodeId));
        nodeId = setup.level.nodes.find((n) => n.buildable && !taken.has(n.id))?.id;
      }
      if (!nodeId) return [];
      return [
        { type: 'placeDefense', side: 'defender', tick: snapshot.tick, defenseTypeId: defense.id, nodeId },
      ];
    },
  };
}
