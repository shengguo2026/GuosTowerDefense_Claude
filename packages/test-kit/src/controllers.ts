import type { Command, MatchSnapshot, MatchSetup } from '@gtd/sim';

/** Something that looks at the match and issues commands for one side: a scripted bot now, the real AI from M3. */
export interface Controller {
  decide(snapshot: MatchSnapshot, setup: MatchSetup): Command[];
}

export const idleController: Controller = { decide: () => [] };

export interface ScriptedAttackerOptions {
  groupSize?: number;
  everyTicks?: number;
  /** Cycle through every unit type instead of always taking the cheapest. */
  mixUnits?: boolean;
}

/** Launches one group at a time when it can afford it, cycling through the routes. */
export function scriptedAttacker(
  groupSize = 1,
  everyTicks = 40,
  options: ScriptedAttackerOptions = {},
): Controller {
  let routeIndex = 0;
  let unitIndex = 0;
  return {
    decide(snapshot, setup) {
      if (snapshot.tick % everyTicks !== 1) return [];
      const units = [...setup.attacker.units].sort((a, b) => a.cost - b.cost);
      const unit = options.mixUnits ? units[unitIndex % units.length] : units[0];
      if (!unit || unit.cost * groupSize > snapshot.resources.attacker) return [];
      unitIndex++;
      const route = setup.level.routes[routeIndex++ % setup.level.routes.length];
      if (!route) return [];
      return [
        {
          type: 'launchGroup',
          side: 'attacker',
          tick: snapshot.tick,
          unitTypeId: unit.id,
          count: groupSize,
          routeId: route.id,
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
}

/** Builds defenses on free buildable nodes whenever it can afford one, alternating defense types. */
export function scriptedDefender(options: ScriptedDefenderOptions = {}): Controller {
  const { maxDefenses = Infinity, startTick = 0 } = options;
  return {
    decide(snapshot, setup) {
      if (snapshot.tick < startTick) return [];
      const built = snapshot.entities.filter((e) => e.kind === 'defense');
      if (built.length >= maxDefenses) return [];
      const defenses = setup.defender.defenses;
      const defense = defenses[built.length % Math.max(1, defenses.length)];
      if (!defense || defense.cost > snapshot.resources.defender) return [];
      const taken = new Set(built.flatMap((e) => (e.kind === 'defense' ? [e.nodeId] : [])));
      const node = setup.level.nodes.find((n) => n.buildable && !taken.has(n.id));
      if (!node) return [];
      return [
        {
          type: 'placeDefense',
          side: 'defender',
          tick: snapshot.tick,
          defenseTypeId: defense.id,
          nodeId: node.id,
        },
      ];
    },
  };
}
