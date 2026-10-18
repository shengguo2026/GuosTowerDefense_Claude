import {
  distance,
  type Command,
  type DefenseEntity,
  type GroupEntity,
  type MatchSnapshot,
  type SimAbility,
  type SimDefenseType,
  type SimUnitType,
} from '@gtd/sim';
import { AiBase, round } from './aiBase';
import { DEFENDER_TUNING, type DefenderTuning, type Difficulty } from './difficulty';
import {
  objectivePressure,
  reachOf,
  routeExposure,
  toKnown,
  type KnownDefense,
  type RouteModel,
} from './levelModel';

interface BuildOption {
  label: string;
  cost: number;
  /** The layout with this build done, to weigh it against the current one. */
  next: KnownDefense[];
  command: Command;
}

/** Weight of the weakest route in the value of a defense layout; the rest is the average over all routes. */
const WEAKEST_ROUTE_WEIGHT = 0.6;
/** Seen groups raise the weight of their route; the memory fades by this factor per look. */
const ROUTE_MEMORY_FADE = 0.97;
/** A build has to add at least this much value per supply spent. */
const MIN_GAIN_PER_COST = 0.02;

/**
 * The Defender AI. Perception: its own assets and the groups it has detected (where they are, which routes they could
 * be on). Evaluation: how much pressure a layout puts on each route and on the objective. Decision: the build or
 * upgrade that adds the most value per supply, repairs, patrol moves and abilities aimed at real threats. Commands:
 * ordinary placements, upgrades, repairs, orders and abilities.
 */
export class DefenderAi extends AiBase {
  private readonly tuning: DefenderTuning;
  private readonly routeWeight = new Map<string, number>();
  /** Where each patrol was placed, to go back to when there is nothing to chase. */
  private readonly home = new Map<number, string>();
  private reference!: SimUnitType;
  /** Nodes that this round's repairs close again, so a build in the same round does not count them as open. */
  private reclosed = new Set<string>();

  constructor(difficulty: Difficulty, seed: number) {
    super('defender', difficulty, seed, DEFENDER_TUNING[difficulty].thinkEveryTicks);
    this.tuning = DEFENDER_TUNING[difficulty];
  }

  protected think(snapshot: MatchSnapshot): Command[] {
    // The unit it plans against: the fastest one, which spends the least time in reach.
    this.reference ??= [...this.model.setup.attacker.units].sort(
      (a, b) => b.speed - a.speed,
    )[0] as SimUnitType;
    const own = snapshot.entities.filter((e): e is DefenseEntity => e.kind === 'defense');
    const groups = snapshot.entities.filter((e): e is GroupEntity => e.kind === 'group');
    this.trackRoutes(groups);
    const commands: Command[] = [];
    let supplies = snapshot.resources.defender ?? 0;
    this.reclosed = new Set();

    for (const repair of this.repairs(snapshot, own, groups, supplies)) {
      commands.push(repair.command);
      supplies -= repair.cost;
    }
    commands.push(...this.movePatrols(snapshot, own, groups));
    commands.push(...this.useAbilities(snapshot, own, groups));
    const build = this.chooseBuild(snapshot, own, supplies);
    if (build) commands.push(build);
    return commands;
  }

  // ---- Perception

  private trackRoutes(groups: GroupEntity[]): void {
    for (const route of this.model.routes)
      this.routeWeight.set(route.id, (this.routeWeight.get(route.id) ?? 1) * ROUTE_MEMORY_FADE);
    for (const group of groups) {
      const routes = this.model.routesAt(group);
      for (const route of routes)
        this.routeWeight.set(route.id, (this.routeWeight.get(route.id) ?? 1) + 1 / routes.length);
    }
  }

  private known(own: DefenseEntity[]): KnownDefense[] {
    return own.flatMap((d) => {
      const type = this.model.defenseType(d.defenseTypeId);
      if (!type) return [];
      const known = toKnown(d, type);
      // A patrol counts where it is posted, not where it happens to walk right now.
      if (type.mobile && d.order?.type === 'guard') {
        const node = this.model.graph.node(d.order.nodeId);
        return [{ ...known, x: node.x, z: node.z, boosted: false }];
      }
      return [{ ...known, boosted: false }];
    });
  }

  // ---- Evaluation

  /** Pressure-seconds an attacker can expect from this layout: on its best route, and while holding the objective. */
  private value(layout: KnownDefense[]): number {
    const total = [...this.routeWeight.values()].reduce((a, b) => a + b, 0) || 1;
    let weakest = Infinity;
    let weighted = 0;
    for (const route of this.model.routes) {
      const exposure = routeExposure(this.model, route, layout, {
        unit: this.reference,
        formation: 'spread',
        members: 10,
      }).pressure;
      weakest = Math.min(weakest, exposure);
      weighted += (exposure * (this.routeWeight.get(route.id) ?? 1)) / total;
    }
    const hold = this.model.setup.level.objective.holdSeconds;
    const goal = objectivePressure(this.model, layout);
    const objective = this.tuning.contestsObjective
      ? goal.pressure * hold * (goal.contested ? 2 : 1) + (goal.contested ? hold * 0.5 : 0)
      : goal.pressure * hold;
    return WEAKEST_ROUTE_WEIGHT * weakest + (1 - WEAKEST_ROUTE_WEIGHT) * weighted + objective;
  }

  // ---- Building

  private chooseBuild(snapshot: MatchSnapshot, own: DefenseEntity[], supplies: number): Command | null {
    const budget = supplies - this.tuning.reserve;
    const layout = this.known(own);
    // Only what it can pay for now is weighed: most looks end here while it saves up.
    const options = this.buildOptions(snapshot, own, layout).filter((o) => o.cost <= budget);
    if (options.length === 0) return null;
    if (!this.tuning.readsMap || this.slips(this.tuning.mistakeChance)) {
      const placements = options.filter((o) => o.command.type === 'placeDefense');
      if (placements.length === 0) return null;
      const pick = this.rng.pick(placements);
      this.note(`Build ${pick.label} (picked without weighing the map)`);
      return pick.command;
    }
    const base = this.value(layout);
    let best: BuildOption | null = null;
    let bestGain = 0;
    for (const option of options) {
      const gain = this.value(option.next) - base;
      if (best === null || gain / option.cost > bestGain / best.cost) {
        best = option;
        bestGain = gain;
      }
    }
    if (!best || bestGain / best.cost < MIN_GAIN_PER_COST) {
      this.note('Saving supplies: no build or upgrade adds enough right now');
      return null;
    }
    this.note(`Build ${best.label}: +${round(bestGain)} pressure-seconds for ${best.cost} supplies`);
    return best.command;
  }

  private buildOptions(snapshot: MatchSnapshot, own: DefenseEntity[], layout: KnownDefense[]): BuildOption[] {
    const options: BuildOption[] = [];
    const tick = snapshot.tick;
    const occupied = new Set(own.filter((d) => !d.mobile).map((d) => d.nodeId));
    const closed = new Set([...own.filter((d) => d.blocking).map((d) => d.nodeId), ...this.reclosed]);
    for (const type of this.model.setup.defender.defenses) {
      const count = own.filter((d) => d.defenseTypeId === type.id).length;
      if (type.maxCount !== undefined && count >= type.maxCount) continue;
      for (const node of this.model.setup.level.nodes) {
        if (!this.canPlace(type, node.id) || (!type.mobile && occupied.has(node.id))) continue;
        const blocks = type.blocksNode && this.model.graph.routeNodes.has(node.id);
        if (blocks && !this.model.graph.hasOpenRoute(new Set([...closed, node.id]))) continue;
        const added: KnownDefense = {
          id: -1,
          type,
          x: node.x,
          z: node.z,
          level: 1,
          condition: 100,
          blocking: blocks,
          nodeId: node.id,
        };
        options.push({
          label: `${type.id} at ${node.id}`,
          cost: type.cost,
          next: [...layout, added],
          command: { type: 'placeDefense', side: 'defender', tick, defenseTypeId: type.id, nodeId: node.id },
        });
      }
    }
    if (this.tuning.upgrades) {
      for (const defense of own) {
        const type = this.model.defenseType(defense.defenseTypeId);
        if (!type || defense.level >= type.maxLevel || defense.condition <= 0) continue;
        const next = layout.map((d) => (d.id === defense.id ? { ...d, level: d.level + 1 } : d));
        options.push({
          label: `upgrade ${type.id} at ${defense.nodeId} to level ${defense.level + 1}`,
          cost: Math.round(type.cost * type.upgradeCostFactor * defense.level),
          next,
          command: { type: 'upgradeDefense', side: 'defender', tick, defenseId: defense.id },
        });
      }
    }
    return options;
  }

  /** The placement rules, read from the level the same way the simulation applies them. */
  private canPlace(type: SimDefenseType, nodeId: string): boolean {
    const { graph, setup } = this.model;
    const node = graph.node(nodeId);
    const onRoute = graph.routeNodes.has(nodeId);
    const spawn = node.kind === 'spawn' || setup.level.routes.some((route) => route.nodes[0] === nodeId);
    if (type.mobile) return onRoute && !spawn;
    const routeOk = onRoute && !spawn && nodeId !== setup.level.objective.nodeId;
    if (type.placement === 'buildZone') return node.buildable === true;
    if (type.placement === 'routeNode') return routeOk;
    return node.buildable === true || routeOk;
  }

  // ---- Repairs

  private repairs(
    snapshot: MatchSnapshot,
    own: DefenseEntity[],
    groups: GroupEntity[],
    supplies: number,
  ): { cost: number; command: Command }[] {
    if (!this.tuning.repairs) return [];
    const out: { cost: number; command: Command }[] = [];
    const closed = new Set(own.filter((d) => d.blocking).map((d) => d.nodeId));
    for (const defense of own) {
      const type = this.model.defenseType(defense.defenseTypeId);
      if (!type || defense.condition >= 100) continue;
      // Medium mends what is broken; Hard keeps roadblocks topped up, even under pressure.
      if (this.difficulty !== 'hard' && defense.condition > 0) continue;
      if (this.difficulty === 'hard' && defense.condition > 60) continue;
      const cost = Math.ceil((type.cost * 0.5 * (100 - defense.condition)) / 100);
      if (cost > supplies) continue;
      const wouldBlock = type.blocksNode && !type.mobile && this.model.graph.routeNodes.has(defense.nodeId);
      if (
        wouldBlock &&
        !defense.blocking &&
        !this.model.graph.hasOpenRoute(new Set([...closed, defense.nodeId]))
      )
        continue;
      const pushing = groups.filter((g) => g.state === 'blocked' && distance(g, defense) < 4).length;
      this.note(
        `Repair ${type.id} at ${defense.nodeId} (condition ${round(defense.condition, 0)}` +
          (pushing ? `, ${pushing} group(s) pushing` : '') +
          ')',
      );
      out.push({
        cost,
        command: { type: 'repairDefense', side: 'defender', tick: snapshot.tick, defenseId: defense.id },
      });
      supplies -= cost;
      if (wouldBlock) {
        closed.add(defense.nodeId);
        this.reclosed.add(defense.nodeId);
      }
    }
    return out;
  }

  // ---- Patrols

  private movePatrols(snapshot: MatchSnapshot, own: DefenseEntity[], groups: GroupEntity[]): Command[] {
    const patrols = own.filter((d) => d.mobile);
    if (patrols.length === 0) return [];
    for (const patrol of patrols) if (!this.home.has(patrol.id)) this.home.set(patrol.id, patrol.nodeId);
    const commands: Command[] = [];
    const objective = this.model.objective.id;
    const holding = groups.some((g) => g.state === 'atObjective' || distance(g, this.model.objective) < 8);
    const threats = groups
      .filter((g) => g.state !== 'retreating')
      .map((g) => ({ group: g, routes: this.model.routesAt(g) }))
      .filter((t) => t.routes.length > 0)
      .sort((a, b) => this.goalDistance(a.group, a.routes) - this.goalDistance(b.group, b.routes));

    patrols.forEach((patrol, index) => {
      let target = this.home.get(patrol.id) as string;
      let why = 'back to its post';
      if (holding && this.tuning.contestsObjective) {
        target = objective;
        why = 'groups at the objective';
      } else if (index === 0 && this.tuning.contestsObjective) {
        target = objective;
        why = 'contesting the objective';
      } else if (this.tuning.intercepts && threats.length > 0) {
        const threat = threats[Math.min(index - 1, threats.length - 1)] ?? threats[0];
        const node = threat ? this.interceptNode(patrol, threat.group, threat.routes) : null;
        if (node) {
          target = node;
          why = `intercepting group ${threat?.group.id}`;
        }
      }
      const current = patrol.order?.type === 'guard' ? patrol.order.nodeId : null;
      if (current === target) return;
      const type = this.model.defenseType(patrol.defenseTypeId);
      if (!type || !this.canPlace(type, target)) return;
      this.note(`Patrol ${patrol.id} to ${target} (${why})`);
      commands.push({
        type: 'orderDefense',
        side: 'defender',
        tick: snapshot.tick,
        defenseId: patrol.id,
        order: { type: 'guard', nodeId: target },
      });
    });
    return commands;
  }

  private goalDistance(group: GroupEntity, routes: RouteModel[]): number {
    return Math.min(...routes.map((r) => this.model.distanceToGoal(r, group)));
  }

  /** The first node ahead of the group that the patrol can reach before the group does. */
  private interceptNode(patrol: DefenseEntity, group: GroupEntity, routes: RouteModel[]): string | null {
    const type = this.model.defenseType(patrol.defenseTypeId);
    if (!type || type.speed <= 0) return null;
    const route = routes[0] as RouteModel;
    const along = this.model.alongRoute(route, group);
    const groupSpeed = this.reference.speed;
    for (const id of route.nodes.slice(1)) {
      const at = route.nodeAlong.get(id) ?? 0;
      if (at <= along + 1 || !this.canPlace(type, id)) continue;
      const path = this.model.graph.shortestPath(patrol.nodeId, id);
      if (!path) continue;
      const walk = path.reduce((sum, leg) => sum + leg.length, 0) / type.speed;
      if (walk <= (at - along) / groupSpeed) return id;
    }
    return null;
  }

  // ---- Abilities

  private useAbilities(snapshot: MatchSnapshot, own: DefenseEntity[], groups: GroupEntity[]): Command[] {
    const commands: Command[] = [];
    for (const ability of this.model.setup.defender.abilities) {
      if ((snapshot.cooldowns[ability.id] ?? 0) > 0 || (snapshot.points.defender ?? 0) < ability.cost)
        continue;
      const command = this.aimAbility(snapshot, ability, own, groups);
      if (command) {
        commands.push(command);
        break; // one ability per look, so points are not double-spent
      }
    }
    return commands;
  }

  private aimAbility(
    snapshot: MatchSnapshot,
    ability: SimAbility,
    own: DefenseEntity[],
    groups: GroupEntity[],
  ): Command | null {
    const tick = snapshot.tick;
    const active = own.filter((d) => d.condition > 0);
    const effects = new Set(ability.effects.map((e) => e.type));
    if (effects.has('slow') && ability.target === 'unit' && this.tuning.intercept) {
      // Slow the group closest to the goal while it is inside a defense's reach, so it stays there longer.
      const targets = groups
        .filter((g) => g.state === 'moving' || g.state === 'blocked')
        .filter((g) => active.some((d) => distance(d, g) <= ability.range))
        .filter((g) =>
          active.some((d) => {
            const type = this.model.defenseType(d.defenseTypeId);
            return (
              type !== undefined && type.pressurePerSecond > 0 && distance(d, g) <= reachOf(type, d.level)
            );
          }),
        );
      const routesOf = (g: GroupEntity) => this.model.routesAt(g);
      targets.sort((a, b) => this.goalDistance(a, routesOf(a)) - this.goalDistance(b, routesOf(b)));
      const target = targets[0];
      if (!target) return null;
      this.note(`${ability.id} on group ${target.id}: it is in reach and closest to the objective`);
      return { type: 'useAbility', side: 'defender', tick, abilityId: ability.id, groupId: target.id };
    }
    if (effects.has('boost') && this.tuning.rapidResponse) {
      const engaged = active.filter((d) => d.mobile && d.targetGroupId !== null);
      const patrol = engaged[0];
      if (!patrol) return null;
      this.note(`${ability.id} around patrol ${patrol.id}: it is pressing group ${patrol.targetGroupId}`);
      return ability.target === 'area'
        ? { type: 'useAbility', side: 'defender', tick, abilityId: ability.id, x: patrol.x, z: patrol.z }
        : { type: 'useAbility', side: 'defender', tick, abilityId: ability.id };
    }
    if (effects.has('reveal') && ability.target === 'area' && this.tuning.intercept) {
      // Look where the routes leave the Attacker's side once groups are on the way but none is seen.
      if (groups.length > 0 || snapshot.phase !== 'combat') return null;
      const junction = [...this.model.graph.junctions][0];
      if (!junction) return null;
      const node = this.model.graph.node(junction);
      this.note(`${ability.id} at ${junction}: nothing detected yet`);
      return { type: 'useAbility', side: 'defender', tick, abilityId: ability.id, x: node.x, z: node.z };
    }
    return null;
  }
}
