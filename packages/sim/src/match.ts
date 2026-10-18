import {
  COMMAND_SIDES,
  CommandQueue,
  type Command,
  type LaunchWaveCommand,
  type OrderDefenseCommand,
  type PlaceDefenseCommand,
  type UseAbilityCommand,
} from './commandQueue';
import {
  BLOCK_STANDOFF,
  DEFAULT_EFFECT_MAGNITUDE,
  FORMATIONS,
  IDENTIFY_SECONDS,
  LOSE_DETECTION_SECONDS,
  MAX_GROUPS_PER_WAVE,
  MAX_LAUNCH_DELAY_SECONDS,
  REPAIR_COST_SHARE,
  SELL_REFUND,
  SPEED_VARIATION,
  TICK_SECONDS,
  UPGRADE_PRESSURE_BONUS,
  UPGRADE_RANGE_BONUS,
  VISIBILITY_FACTORS,
  secondsToTicks,
} from './constants';
import { EntityStore } from './entityStore';
import { EventLog } from './eventLog';
import { RouteGraph, distance, pointOnPolyline, type Leg, type Point } from './graph';
import { Rng } from './rng';
import {
  TARGET_PRIORITIES,
  type AreaEffect,
  type DefenseEntity,
  type DefenseOrder,
  type GroupEntity,
  type MatchEntity,
  type MatchResult,
  type MatchSetup,
  type MatchSnapshot,
  type Side,
  type SideStats,
  type SimAbility,
  type SimDefenseType,
  type SimEffect,
  type SimUnitType,
} from './types';

/** Simulation-only state of a group that is not part of the snapshot. */
interface GroupInternals {
  unit: SimUnitType;
  speedVariation: number;
  /** The route was already used by an earlier wave (Trail Knowledge). */
  knownRoute: boolean;
  delayTicks: number;
  passedCheckpoints: Set<string>;
  slowUntil: number;
  slowMagnitude: number;
  boostUntil: number;
  boostMagnitude: number;
  concealUntil: number;
  revealedUntil: number;
  detectedTicks: number;
  unseenTicks: number;
  /** The roadblock the group is waiting in front of. */
  blockedBy: number | null;
}

interface PatrolInternals {
  path: Leg[];
  legIndex: number;
  legDistance: number;
  /** Patrol endpoint the asset walks to next. */
  patrolIndex: number;
}

interface WaveRecord {
  groupIds: number[];
  members: number;
  turnedBack: number;
}

interface ActiveArea extends Omit<AreaEffect, 'remainingTicks'> {
  untilTick: number;
}

const ON_FIELD = new Set<GroupEntity['state']>(['moving', 'holding', 'blocked', 'atObjective']);

/**
 * One match of the simulation. Call `enqueue` with commands and `step` once per tick; the match never reads the clock
 * and draws randomness only from its seed, so it runs the same on the server, in headless tests and in replays.
 *
 * Nobody is ever harmed: pressure from defenses turns members back one at a time, and they walk off the map.
 */
export class Match {
  readonly events = new EventLog();
  readonly graph: RouteGraph;
  private readonly commands = new CommandQueue();
  private readonly entities = new EntityStore<MatchEntity>();
  private readonly rng: Rng;
  private readonly unitTypes: Map<string, SimUnitType>;
  private readonly defenseTypes: Map<string, SimDefenseType>;
  private readonly abilities: Record<Side, Map<string, SimAbility>>;
  private readonly preparationTicks: number;
  private readonly endTick: number;
  private readonly holdTicksRequired: number;
  private readonly identifyTicks = secondsToTicks(IDENTIFY_SECONDS);
  private readonly loseTicks = secondsToTicks(LOSE_DETECTION_SECONDS);
  private readonly resources: Record<Side, number>;
  private readonly points: Record<Side, number>;
  private readonly groupData = new Map<number, GroupInternals>();
  private readonly patrolData = new Map<number, PatrolInternals>();
  private readonly defenseBoosts = new Map<number, { untilTick: number; magnitude: number }>();
  private readonly waves = new Map<number, WaveRecord>();
  private readonly cooldownUntil: Record<Side, Map<string, number>> = { attacker: new Map(), defender: new Map() };
  private readonly usedRoutes = new Set<string>();
  /** What the Attacker remembers of each structure it has seen: a copy from the last time it was in sight. */
  private readonly seenDefenses = new Map<number, DefenseEntity>();
  private readonly visibleToAttacker = new Set<number>();
  private readonly defenseRevealedUntil = new Map<number, number>();
  private areas: ActiveArea[] = [];
  private readonly stats: SideStats = {
    attacker: {
      wavesLaunched: 0,
      membersLaunched: 0,
      membersReachedObjective: 0,
      membersTurnedBack: 0,
      membersRetreated: 0,
      checkpointsPassed: 0,
      capacityUsed: 0,
      bestObjectiveProgress: 0,
    },
    defender: {
      membersTurnedBack: 0,
      wavesStopped: 0,
      structuresBuilt: 0,
      patrolsDeployed: 0,
      upgrades: 0,
      groupsIdentified: 0,
    },
  };
  private capacityRemaining: number;
  private nextWaveId = 1;
  private launchReadyTick = 0;
  private tickCount = 0;
  private heldTicks = 0;
  private contested = false;
  private outcome: MatchResult | null = null;

  constructor(private readonly setup: MatchSetup) {
    const { level } = setup;
    this.rng = new Rng(setup.seed);
    this.graph = new RouteGraph(level);
    this.unitTypes = new Map(setup.attacker.units.map((unit) => [unit.id, unit]));
    this.defenseTypes = new Map(setup.defender.defenses.map((defense) => [defense.id, defense]));
    this.abilities = {
      attacker: new Map(setup.attacker.abilities.map((ability) => [ability.id, ability])),
      defender: new Map(setup.defender.abilities.map((ability) => [ability.id, ability])),
    };
    this.preparationTicks = secondsToTicks(level.preparationSeconds);
    this.endTick = this.preparationTicks + secondsToTicks(level.timerSeconds);
    this.holdTicksRequired = secondsToTicks(level.objective.holdSeconds);
    this.resources = { ...level.startingResources };
    this.points = { ...level.startingPoints };
    this.capacityRemaining = level.deploymentCapacity;
    this.launchReadyTick = this.preparationTicks;
    this.events.push({ tick: 0, type: 'matchStarted', seed: setup.seed, levelId: level.id });
  }

  get tick(): number {
    return this.tickCount;
  }

  get result(): MatchResult | null {
    return this.outcome;
  }

  get isOver(): boolean {
    return this.outcome !== null;
  }

  get phase(): MatchSnapshot['phase'] {
    if (this.outcome) return 'ended';
    return this.tickCount < this.preparationTicks ? 'preparation' : 'combat';
  }

  enqueue(command: Command): void {
    this.commands.enqueue(command);
  }

  /** Advances the match by one tick. Does nothing once the match has ended. */
  step(): void {
    if (this.outcome) return;
    this.tickCount++;
    if (this.tickCount === this.preparationTicks) this.events.push({ tick: this.tickCount, type: 'combatStarted' });
    for (const command of this.commands.drain(this.tickCount)) this.apply(command);
    this.addIncome();
    this.areas = this.areas.filter((area) => area.untilTick > this.tickCount);
    this.releaseWaitingGroups();
    this.releaseBlockedGroups();
    this.moveGroups();
    this.movePatrols();
    this.updateDetection();
    this.updateAttackerSight();
    this.applyPressure();
    this.wearRoadblocks();
    this.updateObjective();
    if (this.outcome) return;
    if (this.tickCount >= this.endTick) this.end({ winner: 'defender', reason: 'timerExpired' });
    else if (this.phase === 'combat' && this.capacityExhausted())
      this.end({ winner: 'defender', reason: 'capacityExhausted' });
  }

  /**
   * The match as one side sees it: the Defender sees only detected groups (type and size only once identified), the
   * Attacker sees structures it has seen (remembered where they were) and patrols currently in sight. Without a side
   * this is the full debug view, which is also what hot-seat play shows.
   */
  snapshot(viewer: Side | null = null): MatchSnapshot {
    const level = this.setup.level;
    const objectiveNode = this.graph.node(level.objective.nodeId);
    const own = (side: Side) => viewer === null || viewer === side;
    const cooldowns: Record<string, number> = {};
    for (const side of ['attacker', 'defender'] as const) {
      if (!own(side)) continue;
      for (const id of this.abilities[side].keys())
        cooldowns[id] = Math.max(0, (this.cooldownUntil[side].get(id) ?? 0) - this.tickCount);
    }
    const sideValues = (values: Record<Side, number>) => {
      const out: Partial<Record<Side, number>> = {};
      if (own('attacker')) out.attacker = values.attacker;
      if (own('defender')) out.defender = values.defender;
      return out;
    };
    return {
      tick: this.tickCount,
      phase: this.phase,
      result: this.outcome,
      viewer,
      resources: sideValues(this.resources),
      points: sideValues(this.points),
      capacity: { total: level.deploymentCapacity, remaining: this.capacityRemaining },
      objective: {
        nodeId: objectiveNode.id,
        x: objectiveNode.x,
        z: objectiveNode.z,
        radius: level.objective.radius,
        heldTicks: this.heldTicks,
        requiredTicks: this.holdTicksRequired,
        contested: this.contested,
      },
      remainingTicks: Math.max(0, this.endTick - Math.max(this.tickCount, this.preparationTicks)),
      preparationRemainingTicks: Math.max(0, this.preparationTicks - this.tickCount),
      launchCooldownRemainingTicks: Math.max(0, this.launchReadyTick - this.tickCount),
      activeWaves: this.activeWaveCount(),
      cooldowns,
      areaEffects: this.areas
        .filter((area) => own(area.side))
        .map(({ untilTick, ...area }) => ({ ...area, remainingTicks: untilTick - this.tickCount })),
      entities: this.viewEntities(viewer),
      stats: structuredClone(this.stats),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Commands

  private apply(command: Command): void {
    const reason = this.applyCommand(command);
    if (reason)
      this.events.push({ tick: this.tickCount, type: 'commandRejected', side: command.side, command: command.type, reason });
  }

  /** Returns a rejection reason, or null when the command was carried out. */
  private applyCommand(command: Command): string | null {
    if (command.type !== 'useAbility' && COMMAND_SIDES[command.type] !== command.side) return 'wrongSide';
    switch (command.type) {
      case 'launchWave':
        return this.launchWave(command);
      case 'holdGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        if (group.state === 'holding') return null;
        if (group.state !== 'moving' && group.state !== 'waiting') return 'cannotHold';
        if (!this.junctionAhead(group)) return 'noJunctionAhead';
        group.holdAtJunction = true;
        return null;
      }
      case 'advanceGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        group.holdAtJunction = false;
        if (group.state === 'holding') group.state = 'moving';
        return null;
      }
      case 'rerouteGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        if (!this.graph.routes.has(command.routeId)) return 'unknownRoute';
        if (group.state !== 'holding') return 'notHoldingAtJunction';
        return this.switchRoute(group, command.routeId) ? null : 'routeNotFromHere';
      }
      case 'retreatGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        if (group.state === 'retreating') return null;
        this.startRetreat(group);
        return null;
      }
      case 'setFormation': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        if (!(command.formation in FORMATIONS)) return 'unknownFormation';
        group.formation = command.formation;
        return null;
      }
      case 'placeDefense':
        return this.placeDefense(command);
      case 'upgradeDefense': {
        const defense = this.ownDefense(command.defenseId);
        if (!defense) return 'unknownDefense';
        const type = this.defenseType(defense);
        if (defense.level >= type.maxLevel) return 'maxLevel';
        const cost = this.upgradeCost(defense);
        if (cost > this.resources.defender) return 'notEnoughResources';
        this.resources.defender -= cost;
        defense.spent += cost;
        defense.level++;
        this.stats.defender.upgrades++;
        this.events.push({ tick: this.tickCount, type: 'defenseUpgraded', defenseId: defense.id, level: defense.level });
        return null;
      }
      case 'repairDefense': {
        const defense = this.ownDefense(command.defenseId);
        if (!defense) return 'unknownDefense';
        if (defense.condition >= 100) return 'notDamaged';
        const cost = this.repairCost(defense);
        if (cost > this.resources.defender) return 'notEnoughResources';
        const wouldBlock = this.blocksWhenActive(defense);
        if (wouldBlock && !defense.blocking && !this.graph.hasOpenRoute(this.closedNodes(defense.nodeId)))
          return 'wouldBlockAllRoutes';
        this.resources.defender -= cost;
        defense.spent += cost;
        defense.condition = 100;
        defense.blocking = wouldBlock;
        this.events.push({ tick: this.tickCount, type: 'defenseRepaired', defenseId: defense.id });
        return null;
      }
      case 'sellDefense': {
        const defense = this.ownDefense(command.defenseId);
        if (!defense) return 'unknownDefense';
        const refund = Math.round(defense.spent * SELL_REFUND);
        this.resources.defender += refund;
        this.entities.remove(defense.id);
        this.patrolData.delete(defense.id);
        this.defenseBoosts.delete(defense.id);
        this.events.push({ tick: this.tickCount, type: 'defenseSold', defenseId: defense.id, refund });
        return null;
      }
      case 'orderDefense':
        return this.orderDefense(command);
      case 'setPriority': {
        const defense = this.ownDefense(command.defenseId);
        if (!defense) return 'unknownDefense';
        if (!TARGET_PRIORITIES.includes(command.priority)) return 'unknownPriority';
        defense.priority = command.priority;
        return null;
      }
      case 'focusTarget': {
        const defense = this.ownDefense(command.defenseId);
        if (!defense) return 'unknownDefense';
        if (command.groupId === null) {
          defense.focusGroupId = null;
          return null;
        }
        const group = this.ownGroup(command.groupId);
        if (!group || group.detection === 'unknown') return 'notVisible';
        if (distance(group, defense) > this.reach(defense)) return 'outOfRange';
        defense.focusGroupId = group.id;
        return null;
      }
      case 'useAbility':
        return this.useAbility(command);
    }
  }

  private launchWave(command: LaunchWaveCommand): string | null {
    if (this.phase !== 'combat') return 'preparation';
    if (this.tickCount < this.launchReadyTick) return 'launchCooldown';
    if (this.activeWaveCount() >= this.setup.level.maxActiveWaves) return 'tooManyWaves';
    if (!Array.isArray(command.groups) || command.groups.length < 1 || command.groups.length > MAX_GROUPS_PER_WAVE)
      return 'invalidWave';
    let capacity = 0;
    let cost = 0;
    for (const order of command.groups) {
      const unit = this.unitTypes.get(order.unitTypeId);
      if (!unit) return 'unknownUnit';
      if (!this.graph.routes.has(order.routeId)) return 'unknownRoute';
      if (!(order.formation in FORMATIONS)) return 'unknownFormation';
      if (!Number.isInteger(order.count) || order.count < 1) return 'invalidCount';
      if (!(order.delaySeconds >= 0 && order.delaySeconds <= MAX_LAUNCH_DELAY_SECONDS)) return 'invalidDelay';
      capacity += unit.capacity * order.count;
      cost += unit.cost * order.count;
    }
    if (capacity > this.capacityRemaining) return 'notEnoughCapacity';
    if (cost > this.resources.attacker) return 'notEnoughResources';

    this.resources.attacker -= cost;
    this.capacityRemaining -= capacity;
    this.launchReadyTick = this.tickCount + secondsToTicks(this.setup.level.launchCooldownSeconds);
    const waveId = this.nextWaveId++;
    const wave: WaveRecord = { groupIds: [], members: 0, turnedBack: 0 };
    const known = new Set(this.usedRoutes);
    for (const order of command.groups) {
      const unit = this.unitTypes.get(order.unitTypeId) as SimUnitType;
      const spawn = this.graph.node(this.graph.routes.get(order.routeId)?.nodes[0] as string);
      const delayTicks = secondsToTicks(order.delaySeconds);
      const group = this.entities.create(
        (id): GroupEntity => ({
          id,
          kind: 'group',
          waveId,
          unitTypeId: unit.id,
          count: order.count,
          formation: order.formation,
          routeId: order.routeId,
          leg: 0,
          legDistance: 0,
          state: delayTicks > 0 ? 'waiting' : 'moving',
          holdAtJunction: false,
          pendingRouteId: null,
          pressure: 0,
          detection: 'unknown',
          slowed: false,
          boosted: false,
          x: spawn.x,
          z: spawn.z,
        }),
      );
      this.groupData.set(group.id, {
        unit,
        speedVariation: this.rng.range(1 - SPEED_VARIATION, 1 + SPEED_VARIATION),
        knownRoute: known.has(order.routeId),
        delayTicks,
        passedCheckpoints: new Set(),
        slowUntil: 0,
        slowMagnitude: 0,
        boostUntil: 0,
        boostMagnitude: 0,
        concealUntil: 0,
        revealedUntil: 0,
        detectedTicks: 0,
        unseenTicks: 0,
        blockedBy: null,
      });
      this.usedRoutes.add(order.routeId);
      wave.groupIds.push(group.id);
      wave.members += order.count;
      this.stats.attacker.membersLaunched += order.count;
      this.events.push({
        tick: this.tickCount,
        type: 'groupLaunched',
        groupId: group.id,
        waveId,
        unitTypeId: unit.id,
        count: order.count,
        routeId: order.routeId,
      });
    }
    this.waves.set(waveId, wave);
    this.stats.attacker.wavesLaunched++;
    this.stats.attacker.capacityUsed += capacity;
    this.events.push({ tick: this.tickCount, type: 'waveLaunched', waveId, groupIds: [...wave.groupIds] });
    return null;
  }

  private placeDefense(command: PlaceDefenseCommand): string | null {
    const type = this.defenseTypes.get(command.defenseTypeId);
    const node = this.graph.nodes.get(command.nodeId);
    if (!type) return 'unknownDefense';
    if (!node) return 'unknownNode';
    if (!this.canPlace(type, node.id)) return 'notBuildable';
    if (!type.mobile && this.defenses().some((d) => !d.mobile && d.nodeId === node.id)) return 'occupied';
    if (type.cost > this.resources.defender) return 'notEnoughResources';
    const blocking = type.blocksNode && this.graph.routeNodes.has(node.id);
    if (blocking && !this.graph.hasOpenRoute(this.closedNodes(node.id))) return 'wouldBlockAllRoutes';
    this.resources.defender -= type.cost;
    const defense = this.entities.create(
      (id): DefenseEntity => ({
        id,
        kind: 'defense',
        defenseTypeId: type.id,
        mobile: type.mobile,
        nodeId: node.id,
        level: 1,
        condition: 100,
        blocking,
        priority: 'first',
        focusGroupId: null,
        targetGroupId: null,
        order: type.mobile ? { type: 'guard', nodeId: node.id } : null,
        boosted: false,
        spent: type.cost,
        x: node.x,
        z: node.z,
      }),
    );
    if (type.mobile) {
      this.patrolData.set(defense.id, { path: [], legIndex: 0, legDistance: 0, patrolIndex: 0 });
      this.stats.defender.patrolsDeployed++;
    } else {
      this.stats.defender.structuresBuilt++;
    }
    this.events.push({
      tick: this.tickCount,
      type: 'defensePlaced',
      defenseId: defense.id,
      defenseTypeId: type.id,
      nodeId: node.id,
    });
    return null;
  }

  private canPlace(type: SimDefenseType, nodeId: string): boolean {
    const node = this.graph.node(nodeId);
    const onRoute = this.graph.routeNodes.has(nodeId);
    const spawn = node.kind === 'spawn' || [...this.graph.routes.values()].some((route) => route.nodes[0] === nodeId);
    if (type.mobile) return onRoute && !spawn;
    const objective = nodeId === this.setup.level.objective.nodeId;
    const routeOk = onRoute && !spawn && !objective;
    if (type.placement === 'buildZone') return node.buildable === true;
    if (type.placement === 'routeNode') return routeOk;
    return node.buildable === true || routeOk;
  }

  private orderDefense(command: OrderDefenseCommand): string | null {
    const defense = this.ownDefense(command.defenseId);
    if (!defense) return 'unknownDefense';
    if (!defense.mobile) return 'notMobile';
    const order: DefenseOrder = command.order;
    const targets = order.type === 'guard' ? [order.nodeId] : order.type === 'patrol' ? order.nodeIds : [];
    if (targets.length === 0) return 'invalidOrder';
    const type = this.defenseType(defense);
    for (const id of targets) if (!this.graph.nodes.has(id) || !this.canPlace(type, id)) return 'invalidOrder';
    const patrol = this.patrolData.get(defense.id) as PatrolInternals;
    const current = patrol.path[patrol.legIndex];
    const from = current ? current.to : defense.nodeId;
    const rest = this.graph.shortestPath(from, targets[0] as string);
    if (!rest) return 'unreachable';
    if (order.type === 'patrol' && !this.graph.shortestPath(targets[0] as string, targets[1] as string))
      return 'unreachable';
    patrol.path = current ? [current, ...rest] : rest;
    patrol.legIndex = 0;
    if (!current) patrol.legDistance = 0;
    patrol.patrolIndex = 0;
    defense.order = order.type === 'guard' ? { type: 'guard', nodeId: order.nodeId } : { type: 'patrol', nodeIds: [order.nodeIds[0], order.nodeIds[1]] };
    return null;
  }

  private useAbility(command: UseAbilityCommand): string | null {
    const side = command.side;
    const ability = this.abilities[side]?.get(command.abilityId);
    if (!ability) return 'unknownAbility';
    if (this.phase === 'ended') return 'ended';
    if ((this.cooldownUntil[side].get(ability.id) ?? 0) > this.tickCount) return 'cooldown';
    if (ability.cost > this.points[side]) return 'notEnoughPoints';
    const actions: (() => void)[] = [];
    for (const effect of ability.effects) {
      const planned = this.planEffect(side, ability, effect, command);
      if (typeof planned === 'string') return planned;
      actions.push(planned);
    }
    this.points[side] -= ability.cost;
    this.cooldownUntil[side].set(ability.id, this.tickCount + secondsToTicks(ability.cooldownSeconds));
    for (const action of actions) action();
    if (ability.target === 'area' && command.x !== undefined && command.z !== undefined) {
      this.areas.push({
        abilityId: ability.id,
        side,
        x: command.x,
        z: command.z,
        radius: ability.range,
        untilTick: this.tickCount + Math.max(1, secondsToTicks(ability.durationSeconds)),
      });
    }
    this.events.push({ tick: this.tickCount, type: 'abilityUsed', side, abilityId: ability.id });
    return null;
  }

  /**
   * Abilities are read from data: the target type says what the ability is aimed at and each effect says what happens
   * there. Returns the action to run, or a rejection reason (nothing is spent when an ability is rejected).
   */
  private planEffect(side: Side, ability: SimAbility, effect: SimEffect, command: UseAbilityCommand): (() => void) | string {
    const until = this.tickCount + Math.max(1, secondsToTicks(ability.durationSeconds));
    const magnitude = effect.magnitude ?? DEFAULT_EFFECT_MAGNITUDE;
    const at = this.abilityPoint(ability, command);
    if (at === 'missingTarget') return at;
    const groupTarget = (): GroupEntity | string => {
      if (command.groupId === undefined) return 'missingTarget';
      const group = this.ownGroup(command.groupId);
      if (!group || group.state === 'waiting') return 'unknownGroup';
      return group;
    };

    switch (effect.type) {
      case 'reveal': {
        if (!at) return 'missingTarget';
        if (side === 'attacker')
          return () => {
            for (const defense of this.defenses())
              if (distance(defense, at) <= ability.range) this.defenseRevealedUntil.set(defense.id, until);
          };
        return () => {
          for (const group of this.fieldGroups())
            if (distance(group, at) <= ability.range) this.data(group).revealedUntil = until;
        };
      }
      case 'conceal': {
        if (side !== 'attacker' || !at) return 'invalidTarget';
        return () => {
          for (const group of this.fieldGroups())
            if (distance(group, at) <= ability.range) this.data(group).concealUntil = until;
        };
      }
      case 'slow': {
        if (side !== 'defender') return 'invalidTarget';
        if (ability.target === 'unit') {
          const group = groupTarget();
          if (typeof group === 'string') return group;
          if (group.detection === 'unknown') return 'notVisible';
          const inReach = this.activeDefenses().some((d) => distance(d, group) <= ability.range);
          if (!inReach) return 'outOfRange';
          return () => this.slowGroup(group, until, magnitude);
        }
        if (!at) return 'missingTarget';
        return () => {
          for (const group of this.fieldGroups()) if (distance(group, at) <= ability.range) this.slowGroup(group, until, magnitude);
        };
      }
      case 'boost': {
        if (side === 'attacker') {
          let targets: GroupEntity[];
          if (ability.target === 'unit') {
            const group = groupTarget();
            if (typeof group === 'string') return group;
            targets = [group];
          } else if (ability.target === 'route') {
            if (!command.routeId || !this.graph.routes.has(command.routeId)) return 'unknownRoute';
            targets = this.fieldGroups().filter((g) => g.routeId === command.routeId);
          } else if (ability.target === 'area') {
            if (!at) return 'missingTarget';
            targets = this.fieldGroups().filter((g) => distance(g, at) <= ability.range);
          } else targets = this.fieldGroups();
          return () => {
            for (const group of targets) {
              const data = this.data(group);
              data.boostUntil = until;
              data.boostMagnitude = magnitude;
            }
          };
        }
        if (ability.target === 'area' && !at) return 'missingTarget';
        return () => {
          for (const defense of this.defenses()) {
            if (!defense.mobile) continue;
            if (at && distance(defense, at) > ability.range) continue;
            this.defenseBoosts.set(defense.id, { untilTick: until, magnitude });
          }
        };
      }
      case 'move': {
        if (side !== 'attacker') return 'invalidTarget';
        const group = groupTarget();
        if (typeof group === 'string') return group;
        const routeId = command.routeId;
        if (!routeId || !this.graph.routes.has(routeId)) return 'unknownRoute';
        if (routeId === group.routeId) return 'sameRoute';
        if (group.state === 'holding') {
          if (!this.canSwitchAt(group, routeId)) return 'routeNotFromHere';
          return () => {
            this.switchRoute(group, routeId);
            group.state = 'moving';
          };
        }
        if (group.state !== 'moving') return 'cannotReroute';
        if (!this.rerouteNodeAhead(group, routeId)) return 'noJunctionAhead';
        return () => {
          group.pendingRouteId = routeId;
          group.holdAtJunction = false;
        };
      }
      case 'resource':
        return () => {
          this.resources[side] += magnitude;
        };
      default:
        return 'unsupportedEffect';
    }
  }

  private abilityPoint(ability: SimAbility, command: UseAbilityCommand): Point | null | 'missingTarget' {
    if (ability.target !== 'area') return null;
    if (!Number.isFinite(command.x) || !Number.isFinite(command.z)) return 'missingTarget';
    return { x: command.x as number, z: command.z as number };
  }

  private slowGroup(group: GroupEntity, until: number, magnitude: number): void {
    const data = this.data(group);
    data.slowUntil = until;
    data.slowMagnitude = Math.max(data.slowMagnitude, magnitude);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Movement

  private addIncome(): void {
    const { incomePerSecond, pointsPerSecond } = this.setup.level;
    for (const side of ['attacker', 'defender'] as const) {
      this.resources[side] += incomePerSecond[side] * TICK_SECONDS;
      this.points[side] += pointsPerSecond[side] * TICK_SECONDS;
    }
  }

  private releaseWaitingGroups(): void {
    for (const group of this.groups()) {
      if (group.state !== 'waiting') continue;
      const data = this.data(group);
      if (--data.delayTicks <= 0) group.state = 'moving';
    }
  }

  private releaseBlockedGroups(): void {
    for (const group of this.groups()) {
      if (group.state !== 'blocked') continue;
      const data = this.data(group);
      const blocker = data.blockedBy === null ? undefined : this.entities.get(data.blockedBy);
      if (!blocker || blocker.kind !== 'defense' || !blocker.blocking) {
        data.blockedBy = null;
        group.state = 'moving';
      }
    }
  }

  private moveGroups(): void {
    const closed = this.blockers();
    for (const group of this.groups()) {
      const data = this.data(group);
      const slowed = data.slowUntil > this.tickCount;
      if (!slowed) data.slowMagnitude = 0;
      let slow = slowed ? data.slowMagnitude : 0;
      for (const defense of this.activeDefenses()) {
        const type = this.defenseType(defense);
        if (type.slow > 0 && distance(defense, group) <= this.reach(defense)) slow = Math.max(slow, type.slow);
      }
      group.slowed = slow > 0 && ON_FIELD.has(group.state);
      group.boosted = data.boostUntil > this.tickCount;
      if (group.state !== 'moving' && group.state !== 'retreating') continue;
      const legs = this.graph.routeLegs(group.routeId);
      const terrain = this.setup.level.terrain[legs[Math.min(group.leg, legs.length - 1)]?.terrain ?? 'cover'];
      let speed = data.unit.speed * data.speedVariation * FORMATIONS[group.formation].speed * terrain.speed * (1 - slow);
      if (group.boosted) speed *= 1 + data.boostMagnitude;
      if (data.knownRoute) speed *= 1 + this.passive('attacker', 'speed', true);
      const step = speed * TICK_SECONDS;
      if (group.state === 'retreating') this.walkBack(group, step);
      else this.walkForward(group, step, closed);
      if (this.entities.get(group.id)) this.placeGroup(group);
    }
  }

  private walkForward(group: GroupEntity, step: number, closed: Map<string, DefenseEntity>): void {
    let remaining = step;
    while (remaining > 0 && group.state === 'moving') {
      const legs = this.graph.routeLegs(group.routeId);
      const leg = legs[group.leg];
      if (!leg) return;
      const blocker = closed.get(leg.to);
      const limit = blocker ? Math.max(group.legDistance, leg.length - BLOCK_STANDOFF) : leg.length;
      if (group.legDistance + remaining < limit) {
        group.legDistance += remaining;
        return;
      }
      remaining -= limit - group.legDistance;
      group.legDistance = limit;
      if (blocker) {
        group.state = 'blocked';
        this.data(group).blockedBy = blocker.id;
        this.events.push({ tick: this.tickCount, type: 'groupBlocked', groupId: group.id, nodeId: leg.to, defenseId: blocker.id });
        return;
      }
      group.leg++;
      group.legDistance = 0;
      this.arrive(group, leg.to);
    }
  }

  private walkBack(group: GroupEntity, step: number): void {
    let remaining = step;
    const legs = this.graph.routeLegs(group.routeId);
    while (remaining > 0) {
      if (remaining < group.legDistance) {
        group.legDistance -= remaining;
        return;
      }
      remaining -= group.legDistance;
      if (group.leg === 0) {
        this.leaveMap(group);
        return;
      }
      group.leg--;
      group.legDistance = (legs[group.leg] as Leg).length;
    }
  }

  /** Handles a group reaching a node: checkpoint bonus, pending reroute, hold, objective. */
  private arrive(group: GroupEntity, nodeId: string): void {
    const data = this.data(group);
    const node = this.graph.node(nodeId);
    const route = this.graph.routes.get(group.routeId) as { nodes: string[] };
    if (node.kind === 'checkpoint' && !data.passedCheckpoints.has(nodeId)) {
      data.passedCheckpoints.add(nodeId);
      const bonus = this.setup.level.bonuses.checkpointPass;
      this.resources.attacker += bonus;
      this.stats.attacker.checkpointsPassed++;
      this.events.push({ tick: this.tickCount, type: 'checkpointPassed', groupId: group.id, nodeId, bonus });
    }
    if (group.leg >= route.nodes.length - 1) {
      group.state = 'atObjective';
      this.stats.attacker.membersReachedObjective += group.count;
      this.events.push({ tick: this.tickCount, type: 'groupReachedObjective', groupId: group.id });
      return;
    }
    if (group.pendingRouteId && this.canSwitchAt(group, group.pendingRouteId)) {
      this.switchRoute(group, group.pendingRouteId);
      group.pendingRouteId = null;
    }
    if (group.holdAtJunction && this.graph.junctions.has(nodeId)) {
      group.holdAtJunction = false;
      group.state = 'holding';
      this.events.push({ tick: this.tickCount, type: 'groupHolding', groupId: group.id, nodeId });
    }
  }

  /** The node a group stands on, when it is exactly at one (holding, or just arrived). */
  private currentNode(group: GroupEntity): string | null {
    if (group.legDistance !== 0) return null;
    return (this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes[group.leg] ?? null;
  }

  private canSwitchAt(group: GroupEntity, routeId: string): boolean {
    const node = this.currentNode(group);
    const route = this.graph.routes.get(routeId);
    if (!node || !route) return false;
    const index = route.nodes.indexOf(node);
    return index >= 0 && index < route.nodes.length - 1;
  }

  private switchRoute(group: GroupEntity, routeId: string): boolean {
    if (routeId === group.routeId || !this.canSwitchAt(group, routeId)) return false;
    const node = this.currentNode(group) as string;
    const route = this.graph.routes.get(routeId) as { nodes: string[] };
    group.routeId = routeId;
    group.leg = route.nodes.indexOf(node);
    group.legDistance = 0;
    group.pendingRouteId = null;
    this.events.push({ tick: this.tickCount, type: 'groupRerouted', groupId: group.id, routeId });
    return true;
  }

  private junctionAhead(group: GroupEntity): boolean {
    const nodes = (this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes;
    return nodes.slice(group.leg + 1, -1).some((id) => this.graph.junctions.has(id));
  }

  private rerouteNodeAhead(group: GroupEntity, routeId: string): boolean {
    const nodes = (this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes;
    const target = (this.graph.routes.get(routeId) as { nodes: string[] }).nodes;
    return nodes.slice(group.leg + 1, -1).some((id) => target.indexOf(id) >= 0 && target.indexOf(id) < target.length - 1);
  }

  private startRetreat(group: GroupEntity): void {
    if (group.state === 'waiting') {
      this.leaveMap(group);
      return;
    }
    const legs = this.graph.routeLegs(group.routeId);
    if (group.legDistance === 0 && group.leg > 0) {
      group.leg--;
      group.legDistance = (legs[group.leg] as Leg).length;
    }
    group.state = 'retreating';
    group.holdAtJunction = false;
    group.pendingRouteId = null;
    this.data(group).blockedBy = null;
    this.events.push({ tick: this.tickCount, type: 'groupRetreating', groupId: group.id });
  }

  /** A retreating group walked off the map: part of its capacity and supplies come back. */
  private leaveMap(group: GroupEntity): void {
    const data = this.data(group);
    const share = this.setup.level.bonuses.retreatRefund;
    const refundCapacity = Math.floor(group.count * data.unit.capacity * share);
    const refundSupplies = Math.round(group.count * data.unit.cost * share);
    this.capacityRemaining += refundCapacity;
    this.resources.attacker += refundSupplies;
    this.stats.attacker.membersRetreated += group.count;
    this.removeGroup(group);
    this.events.push({ tick: this.tickCount, type: 'groupLeft', groupId: group.id, count: group.count, refundCapacity, refundSupplies });
  }

  private placeGroup(group: GroupEntity): void {
    const legs = this.graph.routeLegs(group.routeId);
    const leg = legs[group.leg];
    const end = this.graph.node((this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes.at(-1) as string);
    const at = leg ? pointOnPolyline(leg.points, group.legDistance) : end;
    group.x = at.x;
    group.z = at.z;
  }

  private movePatrols(): void {
    for (const defense of this.defenses()) {
      if (!defense.mobile) continue;
      const boost = this.defenseBoosts.get(defense.id);
      defense.boosted = boost !== undefined && boost.untilTick > this.tickCount;
      if (defense.targetGroupId !== null) continue; // engaging: stays put while intercepting
      const patrol = this.patrolData.get(defense.id) as PatrolInternals;
      const type = this.defenseType(defense);
      let remaining = type.speed * (defense.boosted ? 1 + (boost as { magnitude: number }).magnitude : 1) * TICK_SECONDS;
      while (remaining > 0) {
        const leg = patrol.path[patrol.legIndex];
        if (!leg) {
          if (!this.nextPatrolLeg(defense, patrol)) break;
          continue;
        }
        const left = leg.length - patrol.legDistance;
        if (remaining < left) {
          patrol.legDistance += remaining;
          remaining = 0;
        } else {
          remaining -= left;
          patrol.legIndex++;
          patrol.legDistance = 0;
          defense.nodeId = leg.to;
        }
      }
      const leg = patrol.path[patrol.legIndex];
      const at = leg ? pointOnPolyline(leg.points, patrol.legDistance) : this.graph.node(defense.nodeId);
      defense.x = at.x;
      defense.z = at.z;
    }
  }

  /** At the end of its path a patrolling asset turns around; a guarding one stays. */
  private nextPatrolLeg(defense: DefenseEntity, patrol: PatrolInternals): boolean {
    if (defense.order?.type !== 'patrol') return false;
    const ends = defense.order.nodeIds;
    if (defense.nodeId === ends[patrol.patrolIndex]) patrol.patrolIndex = 1 - patrol.patrolIndex;
    const path = this.graph.shortestPath(defense.nodeId, ends[patrol.patrolIndex] as string);
    if (!path || path.length === 0) return false;
    patrol.path = path;
    patrol.legIndex = 0;
    patrol.legDistance = 0;
    return true;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Information

  private updateDetection(): void {
    const detectionBonus = 1 + this.passive('defender', 'detectionRange', false);
    const defenses = this.activeDefenses();
    for (const group of this.groups()) {
      if (group.state === 'waiting') continue;
      const data = this.data(group);
      const legs = this.graph.routeLegs(group.routeId);
      const terrain = this.setup.level.terrain[legs[Math.min(group.leg, legs.length - 1)]?.terrain ?? 'cover'];
      let visibility = VISIBILITY_FACTORS[data.unit.visibility] * FORMATIONS[group.formation].detection * terrain.detection;
      if (data.concealUntil > this.tickCount) visibility *= 0.5;
      const seen =
        data.revealedUntil > this.tickCount ||
        defenses.some((d) => distance(d, group) <= this.detectionRange(d) * detectionBonus * visibility);
      if (seen) {
        data.unseenTicks = 0;
        data.detectedTicks++;
        if (group.detection === 'unknown') {
          group.detection = 'detected';
          this.events.push({ tick: this.tickCount, type: 'groupDetected', groupId: group.id });
        }
        if (group.detection === 'detected' && data.detectedTicks >= this.identifyTicks) {
          group.detection = 'identified';
          this.stats.defender.groupsIdentified++;
          this.events.push({ tick: this.tickCount, type: 'groupIdentified', groupId: group.id });
        }
      } else if (group.detection !== 'unknown' && ++data.unseenTicks >= this.loseTicks) {
        group.detection = 'unknown';
        data.detectedTicks = 0;
        this.events.push({ tick: this.tickCount, type: 'groupLost', groupId: group.id });
      }
    }
  }

  /** The Attacker sees a defense while one of its groups is close enough, or a reveal ability covers it. */
  private updateAttackerSight(): void {
    this.visibleToAttacker.clear();
    const lookers = this.groups().filter((g) => g.state !== 'waiting');
    for (const defense of this.defenses()) {
      const revealed = (this.defenseRevealedUntil.get(defense.id) ?? 0) > this.tickCount;
      const inSight = revealed || lookers.some((g) => distance(g, defense) <= this.data(g).unit.sightRange);
      if (!inSight) continue;
      this.visibleToAttacker.add(defense.id);
      if (!this.seenDefenses.has(defense.id))
        this.events.push({ tick: this.tickCount, type: 'defenseSeen', defenseId: defense.id });
      if (!defense.mobile) this.seenDefenses.set(defense.id, { ...defense });
    }
    // A remembered structure that is gone is forgotten once a group sees the spot again.
    for (const [id, memory] of this.seenDefenses) {
      if (this.entities.get(id)) continue;
      if (lookers.some((g) => distance(g, memory) <= this.data(g).unit.sightRange)) this.seenDefenses.delete(id);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Pressure and objective

  private applyPressure(): void {
    for (const defense of this.defenses()) {
      defense.targetGroupId = null;
      if (defense.condition <= 0) continue;
      const reach = this.reach(defense);
      const candidates = this.groups().filter(
        (g) => ON_FIELD.has(g.state) && g.detection !== 'unknown' && distance(g, defense) <= reach,
      );
      if (defense.focusGroupId !== null && !this.entities.get(defense.focusGroupId)) defense.focusGroupId = null;
      const target = candidates.find((g) => g.id === defense.focusGroupId) ?? this.pickTarget(defense, candidates);
      if (!target) continue;
      defense.targetGroupId = target.id;
      const type = this.defenseType(defense);
      let pressure = type.pressurePerSecond * (1 + UPGRADE_PRESSURE_BONUS * (defense.level - 1));
      if (defense.boosted) pressure *= 1 + (this.defenseBoosts.get(defense.id)?.magnitude ?? 0);
      target.pressure += pressure * FORMATIONS[target.formation].pressureTaken * TICK_SECONDS;
      this.turnBackMembers(target, defense);
    }
  }

  private pickTarget(defense: DefenseEntity, candidates: GroupEntity[]): GroupEntity | undefined {
    const progress = (g: GroupEntity) => {
      const legs = this.graph.routeLegs(g.routeId);
      let total = g.legDistance;
      for (let i = 0; i < Math.min(g.leg, legs.length); i++) total += (legs[i] as Leg).length;
      return total;
    };
    const strength = (g: GroupEntity) => g.count * this.data(g).unit.resilience - g.pressure;
    const speed = (g: GroupEntity) => this.data(g).unit.speed;
    const score: Record<DefenseEntity['priority'], (g: GroupEntity) => number> = {
      first: progress,
      last: (g) => -progress(g),
      strongest: strength,
      weakest: (g) => -strength(g),
      fastest: speed,
    };
    const by = score[defense.priority];
    let best: GroupEntity | undefined;
    for (const group of candidates) if (!best || by(group) > by(best)) best = group;
    return best;
  }

  private turnBackMembers(group: GroupEntity, defense: DefenseEntity): void {
    const resilience = this.data(group).unit.resilience;
    const bonus = this.setup.level.bonuses.memberTurnedBack;
    while (group.pressure >= resilience && group.count > 0) {
      group.pressure -= resilience;
      group.count--;
      this.resources.defender += bonus;
      this.stats.attacker.membersTurnedBack++;
      this.stats.defender.membersTurnedBack++;
      const wave = this.waves.get(group.waveId) as WaveRecord;
      wave.turnedBack++;
      this.events.push({ tick: this.tickCount, type: 'memberTurnedBack', groupId: group.id, byDefenseId: defense.id, remaining: group.count });
    }
    if (group.count > 0) return;
    this.removeGroup(group);
    this.events.push({ tick: this.tickCount, type: 'groupStopped', groupId: group.id, byDefenseId: defense.id });
    const wave = this.waves.get(group.waveId) as WaveRecord;
    const waveGone = wave.groupIds.every((id) => !this.entities.get(id));
    if (waveGone && wave.turnedBack === wave.members) {
      const waveBonus = this.setup.level.bonuses.waveStopped;
      this.resources.defender += waveBonus;
      this.stats.defender.wavesStopped++;
      this.events.push({ tick: this.tickCount, type: 'waveStopped', waveId: group.waveId, bonus: waveBonus });
    }
  }

  /** Groups pushing against a roadblock wear it down; at 0 condition it is disrupted and the way is open. */
  private wearRoadblocks(): void {
    for (const group of this.groups()) {
      if (group.state !== 'blocked') continue;
      const blocker = this.entities.get(this.data(group).blockedBy ?? -1);
      if (!blocker || blocker.kind !== 'defense' || !blocker.blocking) continue;
      blocker.condition -= this.defenseType(blocker).wearPerMemberSecond * group.count * TICK_SECONDS;
      if (blocker.condition <= 0) {
        blocker.condition = 0;
        blocker.blocking = false;
        blocker.targetGroupId = null;
        this.events.push({ tick: this.tickCount, type: 'defenseDisrupted', defenseId: blocker.id });
      }
    }
  }

  /** Hold progress grows while a group is in the zone and no patrol contests it; it pauses (never resets) otherwise. */
  private updateObjective(): void {
    const { objective } = this.setup.level;
    const centre = this.graph.node(objective.nodeId);
    const holders = this.groups().some((g) => g.state === 'atObjective');
    this.contested = this.activeDefenses().some((d) => d.mobile && distance(d, centre) <= objective.radius);
    if (holders && !this.contested) this.heldTicks++;
    this.stats.attacker.bestObjectiveProgress = Math.max(
      this.stats.attacker.bestObjectiveProgress,
      Math.min(1, this.heldTicks / this.holdTicksRequired),
    );
    if (this.heldTicks >= this.holdTicksRequired) this.end({ winner: 'attacker', reason: 'objectiveCompleted' });
  }

  /** The Attacker can launch nothing more and has nobody left on the map. */
  private capacityExhausted(): boolean {
    if (this.groups().length > 0) return false;
    const cheapest = Math.min(...this.setup.attacker.units.map((unit) => unit.capacity));
    return this.capacityRemaining < cheapest;
  }

  private end(result: MatchResult): void {
    this.outcome = result;
    for (const defense of this.defenses()) defense.targetGroupId = null;
    this.events.push({ tick: this.tickCount, type: 'matchEnded', result });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Views

  private viewEntities(viewer: Side | null): MatchEntity[] {
    const out: MatchEntity[] = [];
    for (const entity of this.entities.all()) {
      if (entity.kind === 'group') {
        if (viewer !== 'defender') out.push({ ...entity });
        else if (entity.state !== 'waiting' && entity.detection !== 'unknown') {
          const identified = entity.detection === 'identified';
          out.push({
            ...entity,
            unitTypeId: identified ? entity.unitTypeId : '',
            count: identified ? entity.count : 0,
            holdAtJunction: false,
            pendingRouteId: null,
            pressure: 0,
          });
        }
      } else if (viewer !== 'attacker') {
        out.push({ ...entity });
      } else if (this.visibleToAttacker.has(entity.id)) {
        out.push(this.attackerCopy(entity, false));
      }
    }
    if (viewer === 'attacker') {
      for (const [id, memory] of this.seenDefenses)
        if (!this.visibleToAttacker.has(id)) out.push(this.attackerCopy(memory, true));
      out.sort((a, b) => a.id - b.id);
    }
    return out;
  }

  private attackerCopy(defense: DefenseEntity, remembered: boolean): DefenseEntity {
    return { ...defense, priority: 'first', focusGroupId: null, order: null, spent: 0, remembered };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers

  private removeGroup(group: GroupEntity): void {
    this.entities.remove(group.id);
    this.groupData.delete(group.id);
    for (const defense of this.defenses()) if (defense.focusGroupId === group.id) defense.focusGroupId = null;
  }

  private activeWaveCount(): number {
    let count = 0;
    for (const wave of this.waves.values()) if (wave.groupIds.some((id) => this.entities.get(id))) count++;
    return count;
  }

  /** Nodes closed by roadblocks right now, plus `extra` (to test a placement or repair against the rule). */
  private closedNodes(extra?: string): Set<string> {
    const closed = new Set(this.blockers().keys());
    if (extra) closed.add(extra);
    return closed;
  }

  private blockers(): Map<string, DefenseEntity> {
    const map = new Map<string, DefenseEntity>();
    for (const defense of this.defenses()) if (defense.blocking && !map.has(defense.nodeId)) map.set(defense.nodeId, defense);
    return map;
  }

  private blocksWhenActive(defense: DefenseEntity): boolean {
    return this.defenseType(defense).blocksNode && !defense.mobile && this.graph.routeNodes.has(defense.nodeId);
  }

  private upgradeCost(defense: DefenseEntity): number {
    const type = this.defenseType(defense);
    return Math.round(type.cost * type.upgradeCostFactor * defense.level);
  }

  private repairCost(defense: DefenseEntity): number {
    return Math.ceil(this.defenseType(defense).cost * REPAIR_COST_SHARE * (100 - defense.condition) / 100);
  }

  private reach(defense: DefenseEntity): number {
    return this.defenseType(defense).range * (1 + UPGRADE_RANGE_BONUS * (defense.level - 1));
  }

  private detectionRange(defense: DefenseEntity): number {
    return this.defenseType(defense).detectionRange * (1 + UPGRADE_RANGE_BONUS * (defense.level - 1));
  }

  /** Sum of a side's passive boosts to `stat`; `knownRoute` passives count only when the condition holds. */
  private passive(side: Side, stat: 'speed' | 'detectionRange', knownRoute: boolean): number {
    let total = 0;
    for (const effect of this.setup[side].passive) {
      if (effect.type !== 'boost' || effect.stat !== stat) continue;
      if (effect.condition === 'knownRoute' && !knownRoute) continue;
      total += effect.magnitude ?? 0;
    }
    return total;
  }

  private defenseType(defense: DefenseEntity): SimDefenseType {
    return this.defenseTypes.get(defense.defenseTypeId) as SimDefenseType;
  }

  private data(group: GroupEntity): GroupInternals {
    return this.groupData.get(group.id) as GroupInternals;
  }

  private ownGroup(id: number): GroupEntity | undefined {
    const entity = this.entities.get(id);
    return entity?.kind === 'group' ? entity : undefined;
  }

  private ownDefense(id: number): DefenseEntity | undefined {
    const entity = this.entities.get(id);
    return entity?.kind === 'defense' ? entity : undefined;
  }

  private groups(): GroupEntity[] {
    return this.entities.filter((entity): entity is GroupEntity => entity.kind === 'group');
  }

  private fieldGroups(): GroupEntity[] {
    return this.groups().filter((g) => g.state !== 'waiting');
  }

  private defenses(): DefenseEntity[] {
    return this.entities.filter((entity): entity is DefenseEntity => entity.kind === 'defense');
  }

  /** Defenses that are not disrupted. */
  private activeDefenses(): DefenseEntity[] {
    return this.defenses().filter((defense) => defense.condition > 0);
  }
}
