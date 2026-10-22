import {
  FORMATIONS,
  TICK_RATE,
  distance,
  type Command,
  type DefenseEntity,
  type Formation,
  type GroupEntity,
  type MatchSnapshot,
  type SimAbility,
  type SimDefenseType,
  type SimUnitType,
} from '@gtd/sim';
import { AiBase, round } from './aiBase';
import { ATTACKER_TUNING, type AttackerTuning, type Difficulty } from './difficulty';
import {
  detectionOf,
  objectivePressure,
  pressureOf,
  reachOf,
  routeExposure,
  toKnown,
  type KnownDefense,
  type RouteModel,
} from './levelModel';

interface WavePlan {
  route: RouteModel;
  unit: SimUnitType;
  formation: Formation;
  members: number;
  losses: number;
  /** Seconds of objective hold the plan is expected to win per capacity it uses. */
  value: number;
}

/** How long a remembered patrol is assumed to still be where it was seen. */
const PATROL_MEMORY_TICKS = 30 * TICK_RATE;
/** A scouted spot is worth scouting again after this long. */
const RESCOUT_TICKS = 90 * TICK_RATE;
/** Points a command slot leaves for the profile's abilities, which do more for their price. */
const COMMAND_RESERVE = 15;
/** Largest share of the remaining capacity one wave uses in the steady plan of attack. */
const STEADY_SHARE = 0.5;
/** Longest a group may stop to take an asset apart (seconds). */
const DISMANTLE_SECONDS = 12;
/** Groups in a defense's reach, or this much closer than its reach, count as under its pressure. */
const PRESSURE_MARGIN = 2;

/**
 * The Attacker AI. Perception: its own groups and the defenses it has seen. Evaluation: for every route, unit and
 * formation, how many members a group would lose on the way and how much objective time the survivors would win.
 * Decision: the plan with the best return, launched once it can afford enough members. Commands: ordinary launches,
 * holds, reroutes, formation changes and abilities.
 */
export class AttackerAi extends AiBase {
  private readonly tuning: AttackerTuning;
  private readonly patrols = new Map<number, KnownDefense & { seenTick: number }>();
  private readonly scouted = new Map<string, number>();
  private patrolsSeen = 0;
  /** This match's plan of attack: one massed wave, or earlier and smaller waves that keep up the pressure. */
  private readonly style: { name: string; share: number; patience: number };

  constructor(difficulty: Difficulty, seed: number) {
    super('attacker', difficulty, seed, ATTACKER_TUNING[difficulty].thinkEveryTicks);
    this.tuning = ATTACKER_TUNING[difficulty];
    const styles = [
      { name: 'massed', share: this.tuning.maxWaveShare, patience: this.tuning.patience },
      {
        name: 'steady',
        share: Math.min(this.tuning.maxWaveShare, STEADY_SHARE),
        patience: this.tuning.patience * 0.8,
      },
    ];
    this.style = this.tuning.readsDefenses ? this.rng.pick(styles) : (styles[0] as (typeof styles)[0]);
  }

  protected think(snapshot: MatchSnapshot): Command[] {
    const known = this.perceive(snapshot);
    const commands: Command[] = [];
    const groups = snapshot.entities.filter((e): e is GroupEntity => e.kind === 'group');
    commands.push(...this.manageGroups(snapshot, groups, known));
    commands.push(...this.dismantle(snapshot, groups, known));
    const recon = this.reconnoitre(snapshot);
    if (recon) commands.push(recon);
    else {
      const ability = this.useProfileAbility(snapshot, groups, known);
      if (ability) commands.push(ability);
    }
    const command = this.useCommandSlot(snapshot, groups, known, commands);
    if (command) commands.push(command);
    const launch = this.planLaunch(snapshot, known);
    if (launch) commands.push(launch);
    return commands;
  }

  // ---- Perception

  private perceive(snapshot: MatchSnapshot): KnownDefense[] {
    const known: KnownDefense[] = [];
    for (const entity of snapshot.entities) {
      if (entity.kind !== 'defense') continue;
      const type = this.model.defenseType(entity.defenseTypeId);
      if (!type) continue;
      const defense = toKnown(entity, type);
      if (type.mobile) {
        if (!this.patrols.has(entity.id)) this.patrolsSeen++;
        this.patrols.set(entity.id, { ...defense, seenTick: snapshot.tick });
      } else known.push(defense);
    }
    for (const [id, patrol] of this.patrols) {
      if (snapshot.tick - patrol.seenTick > PATROL_MEMORY_TICKS) this.patrols.delete(id);
      else known.push(patrol);
    }
    return known;
  }

  /**
   * Patrols are expected on the objective, where they hurt most. Hard expects every mobile asset the Defender may
   * field (as many as the manual allows of each); Medium as many of the strongest as it may field, or the ones it
   * has seen if that is more.
   */
  private objectiveThreat(known: KnownDefense[]): { pressure: number; contested: boolean } {
    const seen = objectivePressure(this.model, known);
    if (!this.tuning.readsDefenses) return seen;
    const mobile = this.model.setup.defender.defenses.filter(
      (d) => d.mobile && d.pressurePerSecond > 0 && d.lifetimeSeconds === undefined,
    );
    if (mobile.length === 0) return seen;
    const atObjective = known.filter((d) => d.type.mobile && distance(d, this.model.objective) <= 6);
    let missing = 0;
    if (this.tuning.reroutes) {
      for (const type of mobile) {
        const there = atObjective.filter((d) => d.type.id === type.id).length;
        missing += Math.max(0, (type.maxCount ?? 1) - there) * type.pressurePerSecond;
      }
    } else {
      const strongest = [...mobile].sort(
        (a, b) => b.pressurePerSecond - a.pressurePerSecond,
      )[0] as SimDefenseType;
      const expected = Math.max(strongest.maxCount ?? 1, this.patrolsSeen);
      missing = Math.max(0, expected - atObjective.length) * strongest.pressurePerSecond;
    }
    return { pressure: seen.pressure + missing, contested: true };
  }

  // ---- Groups on the field

  private manageGroups(snapshot: MatchSnapshot, groups: GroupEntity[], known: KnownDefense[]): Command[] {
    const commands: Command[] = [];
    const tick = snapshot.tick;
    const reroute = this.ability('move');
    let rerouteReady = this.tuning.rapidReroute && reroute !== undefined && this.canUse(snapshot, reroute);
    for (const group of groups) {
      const unit = this.model.unit(group.unitTypeId);
      if (!unit || group.state === 'retreating' || group.state === 'waiting') continue;
      const route = this.model.route(group.routeId);
      const along = this.model.alongRoute(route, group);

      const rerouting = group.pendingRouteId !== null;
      if (this.tuning.reroutes && !rerouting && (group.state === 'moving' || group.state === 'holding')) {
        const better = this.betterRoute(group, route, along, unit, known);
        if (better && group.state === 'holding') {
          this.note(`Group ${group.id}: switching to ${better.id}, less pressure than ${route.id}`);
          commands.push(
            { type: 'rerouteGroup', side: 'attacker', tick, groupId: group.id, routeId: better.id },
            { type: 'advanceGroup', side: 'attacker', tick, groupId: group.id },
          );
          continue;
        }
        if (better && rerouteReady && reroute) {
          this.note(`Group ${group.id}: Rapid Reroute to ${better.id} without stopping`);
          commands.push({
            type: 'useAbility',
            side: 'attacker',
            tick,
            abilityId: reroute.id,
            groupId: group.id,
            routeId: better.id,
          });
          rerouteReady = false;
          continue;
        }
        if (better && !group.holdAtJunction) {
          this.note(`Group ${group.id}: holding at the next junction to leave ${route.id}`);
          commands.push({ type: 'holdGroup', side: 'attacker', tick, groupId: group.id });
          continue;
        }
        if (!better && group.state === 'holding') {
          commands.push({ type: 'advanceGroup', side: 'attacker', tick, groupId: group.id });
          continue;
        }
      }

      if (this.tuning.formations) {
        const ahead = routeExposure(this.model, route, known, {
          unit,
          formation: group.formation,
          members: group.count,
          from: along,
        });
        const atGoal = group.state === 'atObjective' && this.objectiveThreat(known).pressure > 0;
        const wanted: Formation = ahead.pressure > 0 || atGoal ? 'spread' : 'column';
        if (wanted !== group.formation) {
          this.note(
            `Group ${group.id}: ${wanted} formation (${ahead.pressure > 0 ? 'pressure ahead' : 'clear'})`,
          );
          commands.push({
            type: 'setFormation',
            side: 'attacker',
            tick,
            groupId: group.id,
            formation: wanted,
          });
        }
      }
    }
    return commands;
  }

  /** A route the group can still switch to at a junction ahead that costs it clearly fewer members. */
  private betterRoute(
    group: GroupEntity,
    route: RouteModel,
    along: number,
    unit: SimUnitType,
    known: KnownDefense[],
  ): RouteModel | null {
    const ahead = route.nodes.filter(
      (id) => (route.nodeAlong.get(id) ?? 0) >= along - 0.01 && this.model.graph.junctions.has(id),
    );
    if (ahead.length === 0) return null;
    const junction = ahead[0] as string;
    const fromJunction = route.nodeAlong.get(junction) ?? along;
    const options = { unit, formation: group.formation, members: Math.max(1, group.count) };
    const current = routeExposure(this.model, route, known, { ...options, from: fromJunction });
    let best: RouteModel | null = null;
    let bestLosses = current.losses;
    for (const other of this.model.routes) {
      if (other.id === route.id) continue;
      const index = other.nodes.indexOf(junction);
      if (index < 0 || index >= other.nodes.length - 1) continue;
      const losses = routeExposure(this.model, other, known, {
        ...options,
        from: other.nodeAlong.get(junction) ?? 0,
      }).losses;
      if (losses < bestLosses - Math.max(1, group.count * 0.15)) {
        best = other;
        bestLosses = losses;
      }
    }
    return best;
  }

  // ---- Abilities

  private ability(effect: string): SimAbility | undefined {
    return this.model.setup.attacker.abilities.find((a) => a.effects.some((e) => e.type === effect));
  }

  private canUse(snapshot: MatchSnapshot, ability: SimAbility): boolean {
    return (snapshot.cooldowns[ability.id] ?? 0) === 0 && (snapshot.points.attacker ?? 0) >= ability.cost;
  }

  /** Reveals the spot near the routes where most unseen build sites lie. */
  private reconnoitre(snapshot: MatchSnapshot): Command | null {
    if (!this.tuning.recon) return null;
    const recon = this.ability('reveal');
    if (!recon || recon.target !== 'area' || !this.canUse(snapshot, recon)) return null;
    // Look just before the first launch, then whenever it is ready again.
    if (snapshot.phase === 'preparation' && snapshot.preparationRemainingTicks > 3 * TICK_RATE) return null;
    const sites = this.model.setup.level.nodes.filter(
      (n) => n.buildable || (this.model.graph.routeNodes.has(n.id) && n.kind !== 'spawn'),
    );
    let best: { x: number; z: number; count: number; id: string } | null = null;
    for (const centre of sites) {
      const last = this.scouted.get(centre.id);
      if (last !== undefined && snapshot.tick - last < RESCOUT_TICKS) continue;
      const count = sites.filter((s) => distance(s, centre) <= recon.range).length;
      if (!best || count > best.count) best = { x: centre.x, z: centre.z, count, id: centre.id };
    }
    if (!best) return null;
    for (const site of sites)
      if (distance(site, best) <= recon.range) this.scouted.set(site.id, snapshot.tick);
    this.note(`Reconnaissance at ${best.id}: ${best.count} possible build sites in view`);
    return {
      type: 'useAbility',
      side: 'attacker',
      tick: snapshot.tick,
      abilityId: recon.id,
      x: best.x,
      z: best.z,
    };
  }

  // ---- Profile tools

  /** Groups with a dismantle rate stop to take apart a seen asset in their way that they can remove quickly. */
  private dismantle(snapshot: MatchSnapshot, groups: GroupEntity[], known: KnownDefense[]): Command[] {
    if (!this.tuning.dismantles) return [];
    const commands: Command[] = [];
    const claimed = new Set(groups.map((g) => g.focusDefenseId).filter((id) => id !== null));
    const visible = snapshot.entities.filter(
      (e): e is DefenseEntity => e.kind === 'defense' && !e.remembered && e.condition > 0,
    );
    for (const group of groups) {
      const unit = this.model.unit(group.unitTypeId);
      if (!unit || unit.dismantle <= 0 || group.focusDefenseId !== null) continue;
      if (group.state !== 'moving' && group.state !== 'holding') continue;
      const route = this.model.route(group.routeId);
      const along = this.model.alongRoute(route, group);
      const rate = unit.dismantle * group.count * (1 + this.model.dismantleBonus);
      let best: { defense: DefenseEntity; seconds: number } | null = null;
      for (const defense of visible) {
        const type = this.model.defenseType(defense.defenseTypeId);
        if (!type?.dismantlable || claimed.has(defense.id)) continue;
        if (distance(defense, group) > unit.sightRange) continue;
        // Only what works on the rest of its route: it presses, slows, blocks or finds hidden units there.
        const reach = Math.max(reachOf(type, defense.level), type.seesHidden ? type.detectionRange : 0);
        const ahead = route.samples.some((s) => s.along >= along && distance(s, defense) <= reach);
        // Worth a stop only if it presses or slows noticeably, blocks, or would find this hidden unit.
        const matters =
          type.pressurePerSecond >= 0.5 ||
          type.slow >= 0.2 ||
          type.blocksNode ||
          (type.seesHidden && unit.visibility !== 'normal');
        if (!ahead || !matters) continue;
        // Not while other assets press the spot where it would stand.
        const exposed = known.some(
          (d) =>
            d.id !== defense.id &&
            d.condition > 0 &&
            d.type.pressurePerSecond > 0 &&
            distance(d, group) <= reachOf(d.type, d.level),
        );
        if (exposed) continue;
        const seconds = defense.condition / Math.max(0.01, rate);
        if (seconds > DISMANTLE_SECONDS) continue;
        if (!best || seconds < best.seconds) best = { defense, seconds };
      }
      if (!best) continue;
      claimed.add(best.defense.id);
      this.note(
        `Group ${group.id}: taking apart ${best.defense.defenseTypeId} at ${best.defense.nodeId} (about ${round(best.seconds)} s)`,
      );
      commands.push({
        type: 'focusDefense',
        side: 'attacker',
        tick: snapshot.tick,
        groupId: group.id,
        defenseId: best.defense.id,
      });
    }
    return commands;
  }

  /** Members of groups that a known asset presses right now, or is about to. */
  private membersUnderPressure(groups: GroupEntity[], known: KnownDefense[]): number {
    let members = 0;
    for (const group of groups) {
      if (group.state === 'retreating' || group.state === 'waiting') continue;
      if (this.pressedBy(group, known).length > 0) members += group.count;
    }
    return members;
  }

  private pressedBy(group: GroupEntity, known: KnownDefense[]): KnownDefense[] {
    return known.filter(
      (d) =>
        d.condition > 0 &&
        d.type.pressurePerSecond > 0 &&
        distance(d, group) <= reachOf(d.type, d.level) + PRESSURE_MARGIN,
    );
  }

  /**
   * The profile's other abilities, aimed by what they do: disruption at the assets that press its groups hardest,
   * route effects on the route its groups walk, and boosts when many members are under pressure or on the objective.
   */
  private useProfileAbility(
    snapshot: MatchSnapshot,
    groups: GroupEntity[],
    known: KnownDefense[],
  ): Command | null {
    if (snapshot.phase !== 'combat' || groups.length === 0) return null;
    const tick = snapshot.tick;
    const atObjective = groups.filter((g) => g.state === 'atObjective');
    for (const ability of this.model.setup.attacker.abilities) {
      if (!this.canUse(snapshot, ability)) continue;
      const effects = new Set(ability.effects.map((e) => e.type));
      if (effects.has('move') || (effects.has('reveal') && ability.target === 'area')) continue;
      const atGoal = ability.effects.every((e) => e.condition === 'atObjective');
      if (atGoal) {
        if (!this.tuning.objectiveAbilities || atObjective.length === 0) continue;
        // Protection only pays off while something presses the objective; a faster hold always does.
        const pressed = snapshot.objective.contested || objectivePressure(this.model, known).pressure > 0;
        if (effects.has('protect') && !effects.has('boost') && !pressed) continue;
        this.note(`${ability.id}: ${atObjective.length} group(s) at the objective`);
        return { type: 'useAbility', side: 'attacker', tick, abilityId: ability.id };
      }
      if (!this.tuning.profileAbilities) continue;
      if (ability.target === 'self') {
        const pressed = this.membersUnderPressure(groups, known);
        if (pressed < 6) continue;
        this.note(`${ability.id}: ${pressed} members under pressure`);
        return { type: 'useAbility', side: 'attacker', tick, abilityId: ability.id };
      }
      if (ability.target === 'route') {
        const route = this.routeToHelp(groups, known, effects.has('conceal'));
        if (!route) continue;
        this.note(`${ability.id} on ${route.id}: groups on the way there`);
        return { type: 'useAbility', side: 'attacker', tick, abilityId: ability.id, routeId: route.id };
      }
      if (ability.target === 'area' && effects.has('disrupt')) {
        const aim = this.disruptionTarget(snapshot, groups, ability.range, false);
        if (!aim) continue;
        this.note(`${ability.id} at ${aim.label}: ${round(aim.score)} pressure/s out of action`);
        return { type: 'useAbility', side: 'attacker', tick, abilityId: ability.id, x: aim.x, z: aim.z };
      }
      if (ability.target === 'junction' && (effects.has('disrupt') || effects.has('dismantle'))) {
        const aim = this.disruptionTarget(snapshot, groups, ability.range, true);
        if (!aim?.nodeId) continue;
        this.note(`${ability.id} at ${aim.nodeId}: ${aim.label}`);
        return {
          type: 'useAbility',
          side: 'attacker',
          tick,
          abilityId: ability.id,
          nodeId: aim.nodeId,
        };
      }
    }
    return null;
  }

  /**
   * The route where most members are still on the way to the objective. For concealment, only groups that are not
   * detected yet and have a known asset ahead count (hiding a group that is already seen does little).
   */
  private routeToHelp(groups: GroupEntity[], known: KnownDefense[], conceal: boolean): RouteModel | null {
    let best: { route: RouteModel; members: number } | null = null;
    for (const route of this.model.routes) {
      let members = 0;
      for (const group of groups) {
        if (group.routeId !== route.id || group.state !== 'moving') continue;
        const along = this.model.alongRoute(route, group);
        if (route.length - along < route.length * 0.35) continue;
        if (conceal) {
          if (group.detection !== 'unknown') continue;
          const unit = this.model.unit(group.unitTypeId);
          if (!unit) continue;
          const ahead = routeExposure(this.model, route, known, {
            unit,
            formation: group.formation,
            members: group.count,
            from: along,
          });
          if (ahead.pressure <= 0) continue;
        }
        members += group.count;
      }
      if (members >= 3 && (!best || members > best.members)) best = { route, members };
    }
    return best?.route ?? null;
  }

  /**
   * Where disruption takes the most pressure off its groups: seen, working assets that one of its groups is close to
   * (the rules need a group within reach). For junction abilities, a route node, with any roadblock there counted
   * extra; returns `null` when nothing is worth it.
   */
  private disruptionTarget(
    snapshot: MatchSnapshot,
    groups: GroupEntity[],
    radius: number,
    junction: boolean,
  ): { x: number; z: number; score: number; label: string; nodeId?: string } | null {
    const assets = snapshot.entities.filter(
      (e): e is DefenseEntity =>
        e.kind === 'defense' && !e.remembered && e.condition > 0 && !e.statuses.includes('disrupted'),
    );
    const onField = groups.filter((g) => g.state !== 'retreating' && g.state !== 'waiting');
    const near = (at: { x: number; z: number }) =>
      onField.some(
        (g) => distance(g, at) <= Math.max(radius, this.model.unit(g.unitTypeId)?.sightRange ?? 0),
      );
    const centres: { x: number; z: number; label: string; nodeId?: string }[] = junction
      ? [...this.model.graph.routeNodes]
          .filter(
            (id) =>
              id !== this.model.objective.id &&
              this.model.graph.node(id).kind !== 'spawn' &&
              !this.model.setup.level.routes.some((r) => r.nodes[0] === id),
          )
          .map((id) => {
            const node = this.model.graph.node(id);
            return { x: node.x, z: node.z, label: id, nodeId: id };
          })
      : assets.map((d) => ({ x: d.x, z: d.z, label: `${d.defenseTypeId} at ${d.nodeId}` }));
    let best: { x: number; z: number; score: number; label: string; nodeId?: string } | null = null;
    for (const centre of centres) {
      if (!near(centre)) continue;
      let score = 0;
      for (const d of assets) {
        if (distance(d, centre) > radius) continue;
        const type = this.model.defenseType(d.defenseTypeId);
        if (!type) continue;
        if (junction && type.dismantlable) score += pressureOf(type, d.level) + 1;
        if (!type.disruptible) continue;
        // Only assets that press a group, or soon will, are worth it.
        const pressing = onField.some((g) => distance(g, d) <= reachOf(type, d.level) + 6);
        if (!pressing) continue;
        score += pressureOf(type, d.level) + (d.blocking ? 3 : 0);
      }
      if (score >= 1.5 && (!best || score > best.score)) best = { ...centre, score };
    }
    return best;
  }

  /** One command slot per look, on the group that needs it most, only with points to spare for the abilities. */
  private useCommandSlot(
    snapshot: MatchSnapshot,
    groups: GroupEntity[],
    known: KnownDefense[],
    already: Command[],
  ): Command | null {
    if (!this.tuning.commands || snapshot.phase !== 'combat') return null;
    const spent = already.some((c) => c.type === 'useAbility');
    const points = snapshot.points.attacker ?? 0;
    for (const action of this.model.setup.attacker.commands) {
      if (action.order || action.effects.length === 0) continue;
      if ((snapshot.cooldowns[action.id] ?? 0) > 0 || spent || points < action.cost + COMMAND_RESERVE)
        continue;
      const effects = new Set(action.effects.map((e) => e.type));
      const moving = groups.filter((g) => g.state === 'moving' && g.count > 0);
      let group: GroupEntity | undefined;
      let why = '';
      if (effects.has('conceal')) {
        // Stay Low: an unseen group about to come into the sight of an asset that does not see hidden units.
        group = moving.find(
          (g) =>
            g.detection === 'unknown' &&
            this.pressedBy(g, known).length === 0 &&
            known.some(
              (d) =>
                d.condition > 0 &&
                !d.type.seesHidden &&
                distance(d, g) <= detectionOf(d.type, d.level) * this.model.detectionBonus + 4,
            ),
        );
        why = 'unseen, slipping past an asset';
      } else if (effects.has('boost')) {
        // Rush: out of an asset's reach faster.
        group = moving
          .filter((g) => this.pressedBy(g, known).length > 0)
          .sort((a, b) => b.count - a.count)[0];
        why = 'under pressure';
      } else if (effects.has('reveal')) {
        // Scout Ahead: look at build sites ahead that it has not seen for a while.
        group = moving.find((g) =>
          this.model.setup.level.nodes.some(
            (n) =>
              (n.buildable || this.model.graph.routeNodes.has(n.id)) &&
              distance(n, g) <= action.range &&
              snapshot.tick - (this.scouted.get(n.id) ?? -RESCOUT_TICKS) >= RESCOUT_TICKS,
          ),
        );
        if (group) {
          const at = group;
          for (const n of this.model.setup.level.nodes)
            if (distance(n, at) <= action.range) this.scouted.set(n.id, snapshot.tick);
        }
        why = 'looking ahead';
      }
      if (!group) continue;
      this.note(`${action.id} on group ${group.id}: ${why}`);
      return {
        type: 'useCommand',
        side: 'attacker',
        tick: snapshot.tick,
        commandId: action.id,
        groupId: group.id,
      };
    }
    return null;
  }

  // ---- Waves

  private planLaunch(snapshot: MatchSnapshot, known: KnownDefense[]): Command | null {
    if (snapshot.phase !== 'combat' || snapshot.launchCooldownRemainingTicks > 0) return null;
    if (snapshot.activeWaves >= this.model.setup.level.maxActiveWaves) return null;
    const supplies = snapshot.resources.attacker ?? 0;
    const capacity = snapshot.capacity.remaining;
    const plan = this.tuning.readsDefenses ? this.bestPlan(snapshot, known) : this.plainPlan(capacity);
    if (!plan) return null;
    const unit = plan.unit;
    const everything = Math.floor(capacity / unit.capacity);
    if (everything < 1) return null;
    const shareCap = Math.max(1, Math.floor(everything * this.style.share));
    const short = this.tuning.readsDefenses && this.timeIsShort(snapshot, plan);
    let target = Math.min(plan.members, shareCap);
    // The plan needs all that is left, too little would be left for a useful wave afterwards, or there is no time
    // for one: send everything.
    if (short || plan.members >= everything || everything - target < Math.max(2, target / 2))
      target = everything;
    const affordable = Math.floor(supplies / unit.cost);
    const members = Math.min(target, affordable);
    if (members < 1) return null;
    if (!short && members < Math.ceil(target * this.style.patience)) {
      this.note(`Saving up for ${target} ${unit.id} on ${plan.route.id} (${this.style.name} attack)`);
      return null;
    }
    if (!short && this.tuning.readsDefenses && members <= plan.losses && members < everything) {
      this.note(`Waiting: ${members} ${unit.id} would not get through ${plan.route.id}`);
      return null;
    }
    this.note(
      `Launch ${members} ${unit.id} on ${plan.route.id} (${plan.formation}): expect to lose ${round(plan.losses)}` +
        (short ? ', time is short' : ''),
    );
    return {
      type: 'launchWave',
      side: 'attacker',
      tick: snapshot.tick,
      groups: [
        {
          unitTypeId: unit.id,
          count: members,
          formation: plan.formation,
          routeId: plan.route.id,
          delaySeconds: 0,
        },
      ],
    };
  }

  /** Easy: a group of a random size on a random route, no estimates. */
  private plainPlan(capacity: number): WavePlan | null {
    const unit = this.rng.pick(this.model.setup.attacker.units);
    const [low, high] = this.tuning.plainWaveSize;
    const members = Math.min(this.rng.int(low, high), Math.floor(capacity / unit.capacity));
    if (members < 1) return null;
    return {
      route: this.rng.pick(this.model.routes),
      unit,
      formation: 'column',
      members,
      losses: 0,
      value: 0,
    };
  }

  private bestPlan(snapshot: MatchSnapshot, known: KnownDefense[]): WavePlan | null {
    const goal = this.objectiveThreat(known);
    const holdLeft = (snapshot.objective.requiredTicks - snapshot.objective.heldTicks) / TICK_RATE;
    const holdRate = goal.contested ? 0.5 : 1;
    const capacity = snapshot.capacity.remaining;
    const plans: WavePlan[] = [];
    for (const route of this.model.routes) {
      for (const unit of this.model.setup.attacker.units) {
        const maxMembers = Math.floor(capacity / unit.capacity);
        if (maxMembers < 1) continue;
        for (const formation of Object.keys(FORMATIONS) as Formation[]) {
          if (!this.tuning.formations && formation !== 'column') continue;
          const transit = routeExposure(this.model, route, known, { unit, formation, members: 10 });
          // Members lost per second on the objective, and seconds of the hold still to win.
          const lossRate = (goal.pressure * FORMATIONS[formation].pressureTaken) / unit.resilience;
          // Units built for the objective win its hold time faster.
          const rate = holdRate * unit.objectiveRate;
          const needed = Math.ceil((transit.losses + lossRate * (holdLeft / rate) + 1) * this.tuning.margin);
          const members = Math.min(maxMembers, Math.max(needed, 1));
          const arriving = Math.max(0, members - transit.losses);
          const holdWon = lossRate > 0 ? (arriving / lossRate) * rate : holdLeft;
          const value = Math.min(holdWon, holdLeft) / (members * unit.capacity);
          plans.push({ route, unit, formation, members, losses: transit.losses, value });
        }
      }
    }
    if (plans.length === 0) return null;
    plans.sort((a, b) => b.value - a.value || a.losses - b.losses);
    const best = plans[0] as WavePlan;
    this.note(
      `Objective: ${round(holdLeft)} s to hold, ${round(goal.pressure)} pressure/s there` +
        (goal.contested ? ', contested' : ''),
    );
    for (const route of this.model.routes) {
      const plan = plans.find((p) => p.route === route);
      if (plan)
        this.note(`Route ${route.id}: about ${round(plan.losses)} lost on the way with ${plan.unit.id}`);
    }
    if (this.slips(this.tuning.mistakeChance)) {
      const other = this.rng.pick(plans);
      this.note(`Slip: going with ${other.route.id} instead`);
      return other;
    }
    return best;
  }

  /** Not enough time left to wait for another wave after this one. */
  private timeIsShort(snapshot: MatchSnapshot, plan: WavePlan): boolean {
    const speed = plan.unit.speed * FORMATIONS[plan.formation].speed;
    const walk = plan.route.length / speed;
    const holdLeft = (snapshot.objective.requiredTicks - snapshot.objective.heldTicks) / TICK_RATE;
    const spare = snapshot.remainingTicks / TICK_RATE - walk - (holdLeft * 2) / plan.unit.objectiveRate;
    return spare < this.model.setup.level.launchCooldownSeconds * 2;
  }
}
