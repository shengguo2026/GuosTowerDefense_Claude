import type { Command, MatchSnapshot, MatchSetup } from '@gtd/sim';

/** Something that looks at the match and issues commands for one side: a scripted bot now, the real AI from M3. */
export interface Controller {
  decide(snapshot: MatchSnapshot, setup: MatchSetup): Command[];
}

export const idleController: Controller = { decide: () => [] };

/** Launches the cheapest affordable unit, one group at a time, cycling through the routes. */
export function scriptedAttacker(groupSize = 1, everyTicks = 40): Controller {
  let routeIndex = 0;
  return {
    decide(snapshot, setup) {
      if (snapshot.tick % everyTicks !== 1) return [];
      const unit = [...setup.attacker.units].sort((a, b) => a.cost - b.cost)[0];
      if (!unit || unit.cost * groupSize > snapshot.resources.attacker) return [];
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

/** Builds the first defense type on the next free buildable node whenever it can afford one. */
export function scriptedDefender(): Controller {
  return {
    decide(snapshot, setup) {
      const defense = setup.defender.defenses[0];
      if (!defense || defense.cost > snapshot.resources.defender) return [];
      const taken = new Set(snapshot.entities.flatMap((e) => (e.kind === 'defense' ? [e.nodeId] : [])));
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
