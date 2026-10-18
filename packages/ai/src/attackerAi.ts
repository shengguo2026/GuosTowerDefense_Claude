import {
  FORMATIONS,
  TICK_RATE,
  distance,
  type Command,
  type Formation,
  type GroupEntity,
  type MatchSnapshot,
  type SimAbility,
  type SimUnitType,
} from '@gtd/sim';
import { AiBase, round } from './aiBase';
import { ATTACKER_TUNING, type AttackerTuning, type Difficulty } from './difficulty';
import { objectivePressure, routeExposure, toKnown, type KnownDefense, type RouteModel } from './levelModel';

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

  constructor(difficulty: Difficulty, seed: number) {
    super('attacker', difficulty, seed, ATTACKER_TUNING[difficulty].thinkEveryTicks);
    this.tuning = ATTACKER_TUNING[difficulty];
  }

  protected think(snapshot: MatchSnapshot): Command[] {
    const known = this.perceive(snapshot);
    const commands: Command[] = [];
    const groups = snapshot.entities.filter((e): e is GroupEntity => e.kind === 'group');
    commands.push(...this.manageGroups(snapshot, groups, known));
    const recon = this.reconnoitre(snapshot);
    if (recon) commands.push(recon);
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

  /** Patrols are expected on the objective, where they hurt most: as many as it has seen, at least one if it can. */
  private objectiveThreat(known: KnownDefense[]): { pressure: number; contested: boolean } {
    const seen = objectivePressure(this.model, known);
    if (!this.tuning.readsDefenses) return seen;
    const patrolType = this.model.setup.defender.defenses.find((d) => d.mobile);
    if (!patrolType) return seen;
    // Hard expects as many patrols as the Defender may field; Medium at least the ones it has seen, or one.
    const most = this.tuning.reroutes ? (patrolType.maxCount ?? 2) : 1;
    const expected = Math.max(most, this.patrolsSeen);
    const atObjective = known.filter((d) => d.type.mobile && distance(d, this.model.objective) <= 6).length;
    const missing = Math.max(0, expected - atObjective);
    return {
      pressure: seen.pressure + missing * patrolType.pressurePerSecond,
      contested: seen.contested || expected > 0,
    };
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
    const shareCap = Math.max(1, Math.floor(everything * this.tuning.maxWaveShare));
    const short = this.tuning.readsDefenses && this.timeIsShort(snapshot, plan);
    let target = Math.min(plan.members, shareCap);
    // The plan needs all that is left, too little would be left for a useful wave afterwards, or there is no time
    // for one: send everything.
    if (short || plan.members >= everything || everything - target < Math.max(2, target / 2))
      target = everything;
    const affordable = Math.floor(supplies / unit.cost);
    const members = Math.min(target, affordable);
    if (members < 1) return null;
    if (!short && members < Math.ceil(target * this.tuning.patience)) {
      this.note(`Saving up for ${target} ${unit.id} on ${plan.route.id}`);
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
          const needed = Math.ceil(
            (transit.losses + lossRate * (holdLeft / holdRate) + 1) * this.tuning.margin,
          );
          const members = Math.min(maxMembers, Math.max(needed, 1));
          const arriving = Math.max(0, members - transit.losses);
          const holdWon = lossRate > 0 ? (arriving / lossRate) * holdRate : holdLeft;
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
    const spare = snapshot.remainingTicks / TICK_RATE - walk - holdLeft * 2;
    return spare < this.model.setup.level.launchCooldownSeconds * 2;
  }
}
