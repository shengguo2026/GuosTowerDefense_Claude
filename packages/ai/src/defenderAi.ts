import {
  TICK_RATE,
  VISIBILITY_FACTORS,
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
  /** A new structure on a site. */
  takesSite: boolean;
  typeId: string;
}

/** Weight of the weakest route in the value of a defense layout; the rest is the average over all routes. */
const WEAKEST_ROUTE_WEIGHT = 0.6;
/** Seen groups raise the weight of their route; the memory fades by this factor per look. */
const ROUTE_MEMORY_FADE = 0.97;
/** A build has to add at least this much value per supply spent. */
const MIN_GAIN_PER_COST = 0.02;
/** With this much in hand, any build that adds something is better than saving more. */
const SPEND_FREELY = 150;
/** Extra price a new structure is weighed with, for the site it takes. */
const SITE_PRICE = 30;
/** It builds the best it can afford now only if that is at least this good, per supply, as the best overall. */
const SAVE_FOR_BETTER = 0.7;
/** Points a command slot leaves for the profile's abilities. */
const COMMAND_RESERVE = 15;

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
  /**
   * The units it plans against, with how much each counts: before it has seen anything, the fastest (least time in
   * reach) and the hardest to see; then more and more the units it has identified.
   */
  private readonly references = new Map<SimUnitType, number>();
  private readonly identified = new Set<number>();
  private reference!: SimUnitType;
  /** Last tick it saw any group, to know when the Attacker is active but out of sight. */
  private lastSeenTick = -Infinity;
  /** Nodes that this round's repairs close again, so a build in the same round does not count them as open. */
  private reclosed = new Set<string>();

  constructor(difficulty: Difficulty, seed: number) {
    super('defender', difficulty, seed, DEFENDER_TUNING[difficulty].thinkEveryTicks);
    this.tuning = DEFENDER_TUNING[difficulty];
  }

  protected think(snapshot: MatchSnapshot): Command[] {
    // The unit it plans against: the fastest one, which spends the least time in reach.
    if (this.references.size === 0) {
      const units = this.model.setup.attacker.units;
      this.reference = [...units].sort((a, b) => b.speed - a.speed)[0] as SimUnitType;
      const hidden = [...units].sort(
        (a, b) => VISIBILITY_FACTORS[a.visibility] - VISIBILITY_FACTORS[b.visibility] || b.speed - a.speed,
      )[0] as SimUnitType;
      this.references.set(this.reference, 1);
      if (hidden !== this.reference) this.references.set(hidden, 0.5);
    }
    const own = snapshot.entities.filter((e): e is DefenseEntity => e.kind === 'defense');
    const groups = snapshot.entities.filter((e): e is GroupEntity => e.kind === 'group');
    if (groups.length > 0) this.lastSeenTick = snapshot.tick;
    for (const group of groups) {
      const unit = this.model.unit(group.unitTypeId);
      if (!unit || this.identified.has(group.id)) continue;
      this.identified.add(group.id);
      this.references.set(unit, (this.references.get(unit) ?? 0) + 1);
    }
    this.trackRoutes(groups);
    const commands: Command[] = [];
    let supplies = snapshot.resources.defender ?? 0;
    this.reclosed = new Set(snapshot.closures.map((c) => c.nodeId));

    for (const repair of this.repairs(snapshot, own, groups, supplies)) {
      commands.push(repair.command);
      supplies -= repair.cost;
    }
    commands.push(...this.movePatrols(snapshot, own, groups));
    const abilities = this.useAbilities(snapshot, own, groups);
    commands.push(...abilities);
    if (abilities.length === 0) {
      const command = this.useCommandSlot(snapshot, own, groups);
      if (command) commands.push(command);
    }
    // An asset an ability brings in this round takes its site and counts against its limit: build next look.
    const spawns = abilities.some(
      (c) =>
        c.type === 'useAbility' &&
        this.model.setup.defender.abilities
          .find((a) => a.id === c.abilityId)
          ?.effects.some((e) => e.type === 'spawn'),
    );
    const build = spawns ? null : this.chooseBuild(snapshot, own, supplies);
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
      let exposure = 0;
      let weights = 0;
      for (const [unit, weight] of this.references) {
        exposure +=
          routeExposure(this.model, route, layout, { unit, formation: 'spread', members: 10 }).pressure *
          weight;
        weights += weight;
      }
      exposure /= weights;
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
    const all = this.buildOptions(snapshot, own, layout);
    const options = all.filter((o) => o.cost <= budget);
    const placements = options.filter((o) => o.command.type === 'placeDefense');
    const random = (): Command | null => {
      if (placements.length === 0) return null;
      // Any asset it can afford, then any site for it (not weighted towards assets that fit on many sites).
      const types = [...new Set(placements.map((o) => o.typeId))];
      const type = this.rng.pick(types);
      const pick = this.rng.pick(placements.filter((o) => o.typeId === type));
      this.note(`Build ${pick.label} (picked without weighing the map)`);
      return pick.command;
    };
    if (!this.tuning.readsMap) return random();
    if (options.length === 0) return null;
    const base = this.value(layout);
    // A structure takes one of the few sites for good, so cheap ones are weighed as if they cost a little more.
    const price = (o: BuildOption) => o.cost + (o.takesSite ? SITE_PRICE : 0);
    let best: { option: BuildOption; gain: number } | null = null;
    let affordable: { option: BuildOption; gain: number } | null = null;
    for (const option of all) {
      const gain = this.value(option.next) - base;
      const better = (than: { option: BuildOption; gain: number } | null) =>
        than === null || gain / price(option) > than.gain / price(than.option);
      if (better(best)) best = { option, gain };
      if (option.cost <= budget && better(affordable)) affordable = { option, gain };
    }
    const bar = supplies >= SPEND_FREELY ? 0 : MIN_GAIN_PER_COST;
    if (!best || !affordable || affordable.gain <= 0 || affordable.gain / price(affordable.option) < bar) {
      this.note('Saving supplies: no build or upgrade adds enough right now');
      return null;
    }
    // Saves up for a clearly better option instead of filling a site with a weaker one now.
    const ratio = (c: { option: BuildOption; gain: number }) => c.gain / price(c.option);
    if (best !== affordable && ratio(affordable) < ratio(best) * SAVE_FOR_BETTER) {
      this.note(`Saving up for ${best.option.label} (${best.option.cost} supplies)`);
      return null;
    }
    // A slip: it builds, but something picked without weighing the map.
    if (this.slips(this.tuning.mistakeChance)) return random();
    const { option, gain } = affordable;
    this.note(`Build ${option.label}: +${round(gain)} pressure-seconds for ${option.cost} supplies`);
    return option.command;
  }

  private buildOptions(snapshot: MatchSnapshot, own: DefenseEntity[], layout: KnownDefense[]): BuildOption[] {
    const options: BuildOption[] = [];
    const tick = snapshot.tick;
    const occupied = new Set(own.filter((d) => !d.mobile).map((d) => d.nodeId));
    const closed = new Set([...own.filter((d) => d.blocking).map((d) => d.nodeId), ...this.reclosed]);
    for (const type of this.model.setup.defender.defenses) {
      const count = own.filter((d) => d.defenseTypeId === type.id).length;
      if (type.maxCount !== undefined && count >= type.maxCount) continue;
      // Temporary assets come from abilities; bought, they are gone before they pay for themselves.
      if (type.lifetimeSeconds !== undefined) continue;
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
          takesSite: !type.mobile,
          typeId: type.id,
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
          takesSite: false,
          typeId: type.id,
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
    const closed = new Set([
      ...own.filter((d) => d.blocking).map((d) => d.nodeId),
      ...snapshot.closures.map((c) => c.nodeId),
    ]);
    for (const defense of own) {
      const type = this.model.defenseType(defense.defenseTypeId);
      if (!type || defense.condition >= 100 || defense.expiresAtTick !== null) continue;
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
    const mobile = own.filter((d) => d.mobile && d.expiresAtTick === null);
    for (const patrol of mobile) if (!this.home.has(patrol.id)) this.home.set(patrol.id, patrol.nodeId);
    const crews = mobile.filter((d) => (this.model.defenseType(d.defenseTypeId)?.repairPerSecond ?? 0) > 0);
    const patrols = mobile.filter((d) => !crews.includes(d));
    const commands: Command[] = this.moveCrews(snapshot, own, crews);
    if (patrols.length === 0) return commands;
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

  /** Maintenance assets go to the route node nearest the most worn asset, and back to their post when all is well. */
  private moveCrews(snapshot: MatchSnapshot, own: DefenseEntity[], crews: DefenseEntity[]): Command[] {
    if (!this.tuning.maintains) return [];
    const commands: Command[] = [];
    const worn = own
      .filter((d) => !d.mobile && d.condition > 0 && d.condition < 90)
      .sort((a, b) => a.condition - b.condition);
    for (const crew of crews) {
      const type = this.model.defenseType(crew.defenseTypeId);
      if (!type) continue;
      const asset = worn.find((d) => distance(d, crew) > reachOf(type, crew.level) - 1);
      const inReach = worn.some((d) => distance(d, crew) <= reachOf(type, crew.level) - 1);
      let target = this.home.get(crew.id) as string;
      let why = 'back to its post';
      if (inReach) continue;
      if (asset) {
        let best: { id: string; d: number } | null = null;
        for (const id of this.model.graph.routeNodes) {
          if (!this.canPlace(type, id)) continue;
          const d = distance(this.model.graph.node(id), asset);
          if (!best || d < best.d) best = { id, d };
        }
        if (best && best.d <= reachOf(type, crew.level) - 1) {
          target = best.id;
          why = `mending ${asset.defenseTypeId} at ${asset.nodeId}`;
        }
      }
      const current = crew.order?.type === 'guard' ? crew.order.nodeId : null;
      if (current === target || !this.canPlace(type, target)) continue;
      this.note(`${type.id} ${crew.id} to ${target} (${why})`);
      commands.push({
        type: 'orderDefense',
        side: 'defender',
        tick: snapshot.tick,
        defenseId: crew.id,
        order: { type: 'guard', nodeId: target },
      });
    }
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
    const active = own.filter((d) => d.condition > 0 && !d.statuses.includes('disrupted'));
    const effects = new Set(ability.effects.map((e) => e.type));
    const holds = effects.has('slow') || effects.has('disrupt');
    if (
      holds &&
      ability.target === 'unit' &&
      (effects.has('disrupt') ? this.tuning.profileAbilities : this.tuning.intercept)
    ) {
      // Slow the group closest to the goal while it is inside a defense's reach, so it stays there longer.
      const targets = groups
        .filter((g) => g.state === 'moving' || g.state === 'blocked')
        .filter((g) => !g.statuses.includes('pinned'))
        .filter((g) => ability.range <= 0 || this.inAbilityRange(active, g, ability.range))
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
      // Only against hidden units (others are found by the assets anyway), once groups were seen lately and vanished.
      if (!this.hiddenAttacker() || snapshot.tick - this.lastSeenTick > 20 * TICK_RATE) return null;
      const junction = [...this.model.graph.junctions][0];
      if (!junction) return null;
      const node = this.model.graph.node(junction);
      this.note(`${ability.id} at ${junction}: groups were seen lately and are out of sight`);
      return { type: 'useAbility', side: 'defender', tick, abilityId: ability.id, x: node.x, z: node.z };
    }
    if (!this.tuning.profileAbilities || snapshot.phase !== 'combat') return null;
    const threats = this.threats(groups);
    if (effects.has('spawn')) return this.aimSpawn(snapshot, ability, own, threats);
    if (effects.has('blockBranch')) return this.aimClosure(snapshot, ability, own, threats);
    if (ability.target === 'area' && (effects.has('slow') || effects.has('protect'))) {
      // Protected Zone: where detected groups are inside the reach of assets that press them.
      const pressed = threats.filter((t) => this.inPressingReach(active, t.group));
      const target = pressed[0];
      if (!target) return null;
      const around = pressed.filter((t) => distance(t.group, target.group) <= ability.range).length;
      this.note(`${ability.id} at group ${target.group.id}: ${around} group(s) under pressure there`);
      return {
        type: 'useAbility',
        side: 'defender',
        tick,
        abilityId: ability.id,
        x: target.group.x,
        z: target.group.z,
      };
    }
    if (ability.target === 'route' && (effects.has('slow') || effects.has('reveal'))) {
      // Route Analysis: the route with the most groups on their way to the objective.
      const count = new Map<string, number>();
      for (const t of threats)
        for (const route of t.routes) count.set(route.id, (count.get(route.id) ?? 0) + 1 / t.routes.length);
      const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!best || best[1] < 1) return null;
      this.note(`${ability.id} on ${best[0]}: ${round(best[1])} group(s) on it`);
      return { type: 'useAbility', side: 'defender', tick, abilityId: ability.id, routeId: best[0] };
    }
    return null;
  }

  /**
   * The rules want one of its working assets within the ability's range of the group. An Attacker who can sabotage may
   * put the only one out of action before the ability lands, so then it counts only assets that cannot be sabotaged.
   */
  private inAbilityRange(active: DefenseEntity[], group: GroupEntity, range: number): boolean {
    const sabotage = this.model.setup.attacker.abilities.some((a) =>
      a.effects.some((e) => e.type === 'disrupt'),
    );
    return active.some(
      (d) =>
        distance(d, group) <= range - 1 &&
        !(sabotage && (this.model.defenseType(d.defenseTypeId)?.disruptible ?? true)),
    );
  }

  /** Whether the Attacker has units that are hard to see (or a passive that hides its groups). */
  private hiddenAttacker(): boolean {
    return (
      this.model.lowProfile > 0 || this.model.setup.attacker.units.some((u) => u.visibility !== 'normal')
    );
  }

  /** Detected groups on their way, nearest to the objective first, with the routes they may be on. */
  private threats(groups: GroupEntity[]): { group: GroupEntity; routes: RouteModel[]; goal: number }[] {
    return groups
      .filter((g) => g.state !== 'retreating')
      .map((g) => {
        const routes = this.model.routesAt(g);
        return { group: g, routes, goal: routes.length > 0 ? this.goalDistance(g, routes) : Infinity };
      })
      .filter((t) => t.routes.length > 0)
      .sort((a, b) => a.goal - b.goal);
  }

  private inPressingReach(active: DefenseEntity[], group: GroupEntity): boolean {
    return active.some((d) => {
      const type = this.model.defenseType(d.defenseTypeId);
      return type !== undefined && type.pressurePerSecond > 0 && distance(d, group) <= reachOf(type, d.level);
    });
  }

  /** Route nodes that the rules let it close or block, in front of a group (not behind it). */
  private nodesAhead(group: GroupEntity, routes: RouteModel[]): string[] {
    const out: string[] = [];
    for (const route of routes) {
      const along = this.model.alongRoute(route, group);
      for (const id of route.nodes) {
        const at = route.nodeAlong.get(id) ?? 0;
        if (at > along + 2 && !out.includes(id)) out.push(id);
      }
    }
    return out;
  }

  private closedNow(snapshot: MatchSnapshot, own: DefenseEntity[]): Set<string> {
    return new Set([
      ...own.filter((d) => d.blocking).map((d) => d.nodeId),
      ...snapshot.closures.map((c) => c.nodeId),
      ...this.reclosed,
    ]);
  }

  /**
   * Emergency Reinforcement and Conservation Barrier: a patrol or a temporary barrier on a node in front of the group
   * nearest to the objective (junction abilities never work on the objective or a spawn).
   */
  private aimSpawn(
    snapshot: MatchSnapshot,
    ability: SimAbility,
    own: DefenseEntity[],
    threats: { group: GroupEntity; routes: RouteModel[]; goal: number }[],
  ): Command | null {
    const spawn = ability.effects.find((e) => e.type === 'spawn')?.spawn;
    const type = spawn ? this.model.defenseType(spawn) : undefined;
    const lead = threats[0];
    if (!type || !lead || lead.goal > 40) return null;
    const occupied = new Set(own.filter((d) => !d.mobile).map((d) => d.nodeId));
    const closed = this.closedNow(snapshot, own);
    const objective = this.model.objective.id;
    // A patrol goes to the last node before the objective when groups are close to it, else right in front of them.
    const ahead = this.nodesAhead(lead.group, lead.routes).filter((id) => id !== objective);
    const candidates = type.mobile && lead.goal < 15 ? ahead.reverse() : ahead;
    for (const id of candidates) {
      if (this.model.graph.node(id).kind === 'spawn') continue;
      if (!this.canPlace(type, id) || (!type.mobile && occupied.has(id))) continue;
      const blocks = type.blocksNode && !type.mobile && this.model.graph.routeNodes.has(id);
      if (blocks && !this.model.graph.hasOpenRoute(new Set([...closed, id]))) continue;
      this.note(
        `${ability.id} at ${id}: group ${lead.group.id} is ${round(lead.goal, 0)} from the objective`,
      );
      return { type: 'useAbility', side: 'defender', tick: snapshot.tick, abilityId: ability.id, nodeId: id };
    }
    return null;
  }

  /** Habitat Lockdown: closes the branch right in front of the group nearest to the objective, if another stays open. */
  private aimClosure(
    snapshot: MatchSnapshot,
    ability: SimAbility,
    own: DefenseEntity[],
    threats: { group: GroupEntity; routes: RouteModel[]; goal: number }[],
  ): Command | null {
    const closed = this.closedNow(snapshot, own);
    const objective = this.model.objective.id;
    for (const threat of threats.slice(0, 3)) {
      if (threat.goal > 45) continue;
      for (const id of this.nodesAhead(threat.group, threat.routes)) {
        const node = this.model.graph.node(id);
        if (id === objective || node.kind === 'spawn' || closed.has(id)) continue;
        if (distance(node, threat.group) > 25) continue;
        if (!this.model.graph.hasOpenRoute(new Set([...closed, id]))) continue;
        this.note(`${ability.id} at ${id}: group ${threat.group.id} is about to pass`);
        return {
          type: 'useAbility',
          side: 'defender',
          tick: snapshot.tick,
          abilityId: ability.id,
          nodeId: id,
        };
      }
    }
    return null;
  }

  // ---- Command slots

  /** Fortify an asset that groups wear down or will soon reach; Scan around an asset when hidden groups are about. */
  private useCommandSlot(
    snapshot: MatchSnapshot,
    own: DefenseEntity[],
    groups: GroupEntity[],
  ): Command | null {
    if (!this.tuning.commands || snapshot.phase !== 'combat') return null;
    const points = snapshot.points.defender ?? 0;
    for (const action of this.model.setup.defender.commands) {
      if (action.order || action.effects.length === 0) continue;
      if ((snapshot.cooldowns[action.id] ?? 0) > 0 || points < action.cost + COMMAND_RESERVE) continue;
      const effects = new Set(action.effects.map((e) => e.type));
      let asset: DefenseEntity | undefined;
      let why = '';
      if (effects.has('protect')) {
        asset = own
          .filter((d) => !d.mobile && d.condition > 0 && !d.statuses.includes('protected'))
          .filter((d) => d.blocking || d.condition < 100 || groups.some((g) => distance(g, d) <= 12))
          .sort((a, b) => a.condition - b.condition)[0];
        why = 'groups close by';
      } else if (effects.has('reveal')) {
        if (!this.hiddenAttacker() || groups.length > 0 || snapshot.tick - this.lastSeenTick > 20 * TICK_RATE)
          continue;
        // Scan from the asset that covers the most of the routes.
        let best: { d: DefenseEntity; covered: number } | null = null;
        for (const d of own) {
          let covered = 0;
          for (const route of this.model.routes)
            covered += route.samples.filter((s) => distance(s, d) <= action.range).length;
          if (!best || covered > best.covered) best = { d, covered };
        }
        asset = best?.d;
        why = 'groups were seen lately and vanished';
      } else if (effects.has('boost')) {
        asset = own.find((d) => d.mobile && d.targetGroupId === null && groups.length > 0);
        why = 'to reach groups faster';
      }
      if (!asset) continue;
      this.note(`${action.id} on ${asset.defenseTypeId} at ${asset.nodeId}: ${why}`);
      return {
        type: 'useCommand',
        side: 'defender',
        tick: snapshot.tick,
        commandId: action.id,
        defenseId: asset.id,
      };
    }
    return null;
  }
}
