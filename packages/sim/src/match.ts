import {
  COMMAND_SIDES,
  CommandQueue,
  type Command,
  type FocusDefenseCommand,
  type LaunchWaveCommand,
  type OrderDefenseCommand,
  type PlaceDefenseCommand,
  type UseAbilityCommand,
  type UseCommandCommand,
} from './commandQueue';
import {
  BLOCK_STANDOFF,
  CONTESTED_HOLD_RATE,
  DEFAULT_CONCEAL,
  DEFAULT_EFFECT_MAGNITUDE,
  DEFAULT_PROTECT,
  DISMANTLE_REACH,
  FORMATIONS,
  IDENTIFY_SECONDS,
  JUNCTION_EFFECT_REACH,
  LOSE_DETECTION_SECONDS,
  MAX_GROUPS_PER_WAVE,
  MAX_LAUNCH_DELAY_SECONDS,
  REPAIR_COST_SHARE,
  ROUTE_EFFECT_REACH,
  SELL_REFUND,
  SPEED_VARIATION,
  TICK_SECONDS,
  UPGRADE_PRESSURE_BONUS,
  UPGRADE_RANGE_BONUS,
  VISIBILITY_FACTORS,
  secondsToTicks,
} from './constants';
import {
  AMBUSH_PIN_SECONDS,
  AMBUSH_PRESSURE,
  AMBUSH_SECONDS,
  AMBUSH_SIGHT,
  contactFactor,
  inContact,
} from './contact';
import { EntityStore } from './entityStore';
import { VisionField } from './vision';
import { CROWD_PRESSURE_TAKEN, CROWD_SPLASH, crowdSpeed, crowding, groundOf, groundSpeed } from './ground';
import { EventLog } from './eventLog';
import {
  RouteGraph,
  distance,
  distanceToPolyline,
  pointOnPolyline,
  polylineLength,
  type Leg,
  type Point,
} from './graph';
import { Rng } from './rng';
import { StatusBook } from './statusBook';
import {
  TARGET_PRIORITIES,
  type AreaEffect,
  type BoostStat,
  type Closure,
  type DefenseEntity,
  type DefenseOrder,
  type DefenseStatus,
  type EffectType,
  type GroupEntity,
  type GroupStatus,
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
  detectedTicks: number;
  unseenTicks: number;
  /** The node the group waits in front of, and the roadblock there (null for a closed branch). */
  blockedAt: string | null;
  blockedBy: number | null;
  /** A hold or reroute aimed at one node ahead rather than the next junction or shared node. */
  holdNodeId: string | null;
  switchNodeId: string | null;
  /** Route Capacity: the crossing the group is on or queues in front of, and how packed it is (load / capacity). */
  crossing: string | null;
  crowd: number;
  queued: boolean;
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

/** Where an ability or command works: an area, along a route, everything of the side, or one group or asset. */
type Selector =
  | { kind: 'area'; x: number; z: number; radius: number }
  | { kind: 'route'; routeId: string; radius: number }
  | { kind: 'all' }
  | { kind: 'entity'; id: number };

/** An ability or command whose lasting effects are in force: each tick everything it covers gets them again. */
interface Zone {
  abilityId: string;
  side: Side;
  selector: Selector;
  effects: SimEffect[];
  untilTick: number;
  /** For the map. */
  x: number;
  z: number;
  radius: number;
}

/** Effects that last while their zone does; the others happen once, when the ability is used. */
const KEEP = Symbol('lasting effect');
const LASTING: ReadonlySet<EffectType> = new Set(['slow', 'reveal', 'conceal', 'protect', 'boost']);

const ON_FIELD = new Set<GroupEntity['state']>([
  'moving',
  'holding',
  'blocked',
  'dismantling',
  'atObjective',
]);

/** Who an effect works on, by the side using it: the Attacker's groups or the Defender's assets. */
function recipientsOf(side: Side, type: EffectType): 'groups' | 'defenses' | null {
  switch (type) {
    case 'slow':
      return 'groups';
    case 'reveal':
    case 'disrupt':
      return side === 'attacker' ? 'defenses' : 'groups';
    case 'dismantle':
      return side === 'attacker' ? 'defenses' : null;
    case 'conceal':
    case 'protect':
    case 'boost':
      return side === 'attacker' ? 'groups' : 'defenses';
    default:
      return null;
  }
}

/** Status key of a boost: a stat, or the plain boost (groups: speed; mobile assets: speed and pressure). */
function boostKey(effect: SimEffect): string {
  return `boost:${effect.stat ?? 'plain'}`;
}

/**
 * One match of the simulation. Call `enqueue` with commands and `step` once per tick; the match never reads the clock
 * and draws randomness only from its seed, so it runs the same on the server, in headless tests and in replays.
 *
 * Nobody is ever harmed: pressure from defenses turns members back one at a time, and they walk off the map. Defenses
 * are only ever disrupted (out of action for a while) or dismantled (removed).
 *
 * Abilities and command slots are read from data (spec §2.1): the target type says where an ability works, each
 * effect says what happens there. Lasting effects are kept as zones that refresh the statuses of everything they
 * cover every tick, so a group walking into a revealed area is revealed too.
 */
export class Match {
  readonly events = new EventLog();
  readonly graph: RouteGraph;
  /** Line of sight on this level: Concealment Zones and environment objects. */
  readonly vision: VisionField;
  private readonly commands = new CommandQueue();
  private readonly entities = new EntityStore<MatchEntity>();
  private readonly rng: Rng;
  private readonly unitTypes: Map<string, SimUnitType>;
  private readonly defenseTypes: Map<string, SimDefenseType>;
  private readonly abilities: Record<Side, Map<string, SimAbility>>;
  private readonly slotCommands: Record<Side, Map<string, SimAbility>>;
  private readonly preparationTicks: number;
  private readonly endTick: number;
  private readonly holdTicksRequired: number;
  private readonly identifyTicks: number;
  private readonly loseTicks: number;
  private readonly resources: Record<Side, number>;
  private readonly points: Record<Side, number>;
  private readonly groupData = new Map<number, GroupInternals>();
  private readonly patrolData = new Map<number, PatrolInternals>();
  private readonly status = new StatusBook();
  private readonly waves = new Map<number, WaveRecord>();
  private readonly cooldownUntil: Record<Side, Map<string, number>> = {
    attacker: new Map(),
    defender: new Map(),
  };
  private readonly usedRoutes = new Set<string>();
  /** What the Attacker remembers of each structure it has seen: a copy from the last time it was in sight. */
  private readonly seenDefenses = new Map<number, DefenseEntity>();
  private readonly visibleToAttacker = new Set<number>();
  /** What the Attacker saw last tick: an asset it had not seen can still spring an ambush. */
  private seenLastTick = new Set<number>();
  /** Ambushes already sprung, by asset and group: each asset catches each group by surprise once. */
  private readonly ambushes = new Set<string>();
  /** Assets put out of action by sabotage right now (to notice when they come back). */
  private readonly sabotaged = new Set<number>();
  private readonly closures = new Map<string, number>();
  private readonly routePoints = new Map<string, Point[]>();
  /** Deployment capacity on each narrow crossing this tick (Route Capacity), by edge. */
  private crossingLoad = new Map<string, number>();
  private zones: Zone[] = [];
  private readonly stats: SideStats = {
    attacker: {
      wavesLaunched: 0,
      membersLaunched: 0,
      membersReachedObjective: 0,
      membersTurnedBack: 0,
      membersRetreated: 0,
      checkpointsPassed: 0,
      capacityUsed: 0,
      defensesDisrupted: 0,
      defensesDismantled: 0,
      bestObjectiveProgress: 0,
    },
    defender: {
      membersTurnedBack: 0,
      wavesStopped: 0,
      structuresBuilt: 0,
      patrolsDeployed: 0,
      upgrades: 0,
      groupsIdentified: 0,
      abilitiesUsed: 0,
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
    this.vision = new VisionField(level.vision ?? []);
    this.unitTypes = new Map(setup.attacker.units.map((unit) => [unit.id, unit]));
    this.defenseTypes = new Map(setup.defender.defenses.map((defense) => [defense.id, defense]));
    this.abilities = {
      attacker: new Map(setup.attacker.abilities.map((ability) => [ability.id, ability])),
      defender: new Map(setup.defender.abilities.map((ability) => [ability.id, ability])),
    };
    this.slotCommands = {
      attacker: new Map((setup.attacker.commands ?? []).map((command) => [command.id, command])),
      defender: new Map((setup.defender.commands ?? []).map((command) => [command.id, command])),
    };
    for (const route of level.routes) {
      const points: Point[] = [];
      for (const leg of this.graph.routeLegs(route.id))
        points.push(...(points.length ? leg.points.slice(1) : leg.points));
      this.routePoints.set(route.id, points);
    }
    // Behavioral Analysis: the Defender identifies groups sooner and keeps track of them longer.
    const analysis = this.passive('defender', 'reveal');
    this.identifyTicks = Math.max(
      1,
      Math.round(secondsToTicks(IDENTIFY_SECONDS) * (1 - Math.min(0.9, analysis))),
    );
    this.loseTicks = Math.round(secondsToTicks(LOSE_DETECTION_SECONDS) * (1 + analysis));
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
    if (this.tickCount === this.preparationTicks)
      this.events.push({ tick: this.tickCount, type: 'combatStarted' });
    for (const command of this.commands.drain(this.tickCount)) this.apply(command);
    this.addIncome();
    this.expireEffects();
    this.applyZones();
    this.releaseWaitingGroups();
    this.releaseBlockedGroups();
    this.moveGroups();
    this.movePatrols();
    this.updateDetection();
    this.updateAttackerSight();
    this.applyPressure();
    this.wearRoadblocks();
    this.workOnDefenses();
    this.maintain();
    this.updateObjective();
    this.refreshStatuses();
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
      for (const id of [...this.abilities[side].keys(), ...this.slotCommands[side].keys()])
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
        heldTicks: Math.floor(this.heldTicks),
        requiredTicks: this.holdTicksRequired,
        contested: this.contested && (viewer !== 'attacker' || this.contestVisibleToAttacker()),
      },
      remainingTicks: Math.max(0, this.endTick - Math.max(this.tickCount, this.preparationTicks)),
      preparationRemainingTicks: Math.max(0, this.preparationTicks - this.tickCount),
      launchCooldownRemainingTicks: Math.max(0, this.launchReadyTick - this.tickCount),
      activeWaves: this.activeWaveCount(),
      cooldowns,
      areaEffects: this.zones
        .filter((zone) => own(zone.side))
        .map((zone): AreaEffect => ({
          abilityId: zone.abilityId,
          side: zone.side,
          x: zone.x,
          z: zone.z,
          radius: zone.radius,
          ...(zone.selector.kind === 'route' ? { routeId: zone.selector.routeId } : {}),
          effects: zone.effects.map((e) => e.type),
          remainingTicks: zone.untilTick - this.tickCount,
        })),
      closures: this.viewClosures(viewer),
      entities: this.viewEntities(viewer),
      stats: structuredClone(this.stats),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Commands

  private apply(command: Command): void {
    const reason = this.applyCommand(command);
    if (reason)
      this.events.push({
        tick: this.tickCount,
        type: 'commandRejected',
        side: command.side,
        command: command.type,
        reason,
      });
  }

  /** Returns a rejection reason, or null when the command was carried out. */
  private applyCommand(command: Command): string | null {
    if (
      command.type !== 'useAbility' &&
      command.type !== 'useCommand' &&
      COMMAND_SIDES[command.type] !== command.side
    )
      return 'wrongSide';
    switch (command.type) {
      case 'launchWave':
        return this.launchWave(command);
      case 'holdGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        if (group.state === 'holding') return null;
        if (group.state !== 'moving' && group.state !== 'waiting') return 'cannotHold';
        if (command.nodeId !== undefined) {
          if (!this.graph.junctions.has(command.nodeId) || !this.nodesAhead(group).includes(command.nodeId))
            return 'noJunctionAhead';
        } else if (!this.junctionAhead(group)) return 'noJunctionAhead';
        group.holdAtJunction = true;
        this.data(group).holdNodeId = command.nodeId ?? null;
        return null;
      }
      case 'advanceGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        group.holdAtJunction = false;
        this.data(group).holdNodeId = null;
        if (group.state === 'holding') group.state = 'moving';
        if (group.state === 'dismantling') {
          group.state = 'moving';
          group.focusDefenseId = null;
        }
        return null;
      }
      case 'rerouteGroup': {
        const group = this.ownGroup(command.groupId);
        if (!group) return 'unknownGroup';
        if (!this.graph.routes.has(command.routeId)) return 'unknownRoute';
        if (command.nodeId !== undefined && group.state !== 'holding') {
          if (group.state !== 'moving' && group.state !== 'waiting') return 'cannotHold';
          const target = (this.graph.routes.get(command.routeId) as { nodes: string[] }).nodes;
          const at = target.indexOf(command.nodeId);
          if (command.routeId === group.routeId || at < 0 || at >= target.length - 1)
            return 'routeNotFromHere';
          if (!this.nodesAhead(group).includes(command.nodeId)) return 'routeNotFromHere';
          group.pendingRouteId = command.routeId;
          this.data(group).switchNodeId = command.nodeId;
          return null;
        }
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
      case 'focusDefense':
        return this.focusDefense(command);
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
        this.events.push({
          tick: this.tickCount,
          type: 'defenseUpgraded',
          defenseId: defense.id,
          level: defense.level,
        });
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
        this.removeDefense(defense);
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
      case 'useCommand':
        return this.useCommand(command);
    }
  }

  private launchWave(command: LaunchWaveCommand): string | null {
    if (this.phase !== 'combat') return 'preparation';
    if (this.tickCount < this.launchReadyTick) return 'launchCooldown';
    if (this.activeWaveCount() >= this.setup.level.maxActiveWaves) return 'tooManyWaves';
    if (
      !Array.isArray(command.groups) ||
      command.groups.length < 1 ||
      command.groups.length > MAX_GROUPS_PER_WAVE
    )
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
      const group = this.createGroup(
        waveId,
        unit,
        order.count,
        order.routeId,
        order.formation,
        order.delaySeconds,
        known,
      );
      wave.groupIds.push(group.id);
      wave.members += order.count;
    }
    this.waves.set(waveId, wave);
    this.stats.attacker.wavesLaunched++;
    this.stats.attacker.capacityUsed += capacity;
    this.events.push({ tick: this.tickCount, type: 'waveLaunched', waveId, groupIds: [...wave.groupIds] });
    return null;
  }

  private createGroup(
    waveId: number,
    unit: SimUnitType,
    count: number,
    routeId: string,
    formation: GroupEntity['formation'],
    delaySeconds: number,
    known: ReadonlySet<string>,
  ): GroupEntity {
    const spawn = this.graph.node(this.graph.routes.get(routeId)?.nodes[0] as string);
    const delayTicks = secondsToTicks(delaySeconds);
    const group = this.entities.create((id): GroupEntity => ({
      id,
      kind: 'group',
      waveId,
      unitTypeId: unit.id,
      count,
      formation,
      routeId,
      leg: 0,
      legDistance: 0,
      state: delayTicks > 0 ? 'waiting' : 'moving',
      holdAtJunction: false,
      pendingRouteId: null,
      pressure: 0,
      detection: 'unknown',
      slowed: false,
      boosted: false,
      statuses: [],
      focusDefenseId: null,
      x: spawn.x,
      z: spawn.z,
    }));
    this.groupData.set(group.id, {
      unit,
      speedVariation: this.rng.range(1 - SPEED_VARIATION, 1 + SPEED_VARIATION),
      knownRoute: known.has(routeId),
      delayTicks,
      passedCheckpoints: new Set(),
      detectedTicks: 0,
      unseenTicks: 0,
      blockedAt: null,
      blockedBy: null,
      holdNodeId: null,
      switchNodeId: null,
      crossing: null,
      crowd: 0,
      queued: false,
    });
    this.usedRoutes.add(routeId);
    this.stats.attacker.membersLaunched += count;
    this.events.push({
      tick: this.tickCount,
      type: 'groupLaunched',
      groupId: group.id,
      waveId,
      unitTypeId: unit.id,
      count,
      routeId,
    });
    return group;
  }

  private placeDefense(command: PlaceDefenseCommand): string | null {
    const type = this.defenseTypes.get(command.defenseTypeId);
    const node = this.graph.nodes.get(command.nodeId);
    if (!type) return 'unknownDefense';
    if (!node) return 'unknownNode';
    const where = this.checkSite(type, node.id);
    if (where) return where;
    if (
      type.maxCount !== undefined &&
      this.defenses().filter((d) => d.defenseTypeId === type.id).length >= type.maxCount
    )
      return 'limitReached';
    if (type.cost > this.resources.defender) return 'notEnoughResources';
    this.resources.defender -= type.cost;
    this.createDefense(type, node.id, type.cost, type.lifetimeSeconds);
    return null;
  }

  /** Whether a defense type may stand on a node right now (place, occupancy and the never-block-every-route rule). */
  private checkSite(type: SimDefenseType, nodeId: string): string | null {
    if (!this.canPlace(type, nodeId)) return 'notBuildable';
    if (!type.mobile && this.defenses().some((d) => !d.mobile && d.nodeId === nodeId)) return 'occupied';
    const blocking = type.blocksNode && this.graph.routeNodes.has(nodeId);
    if (blocking && !this.graph.hasOpenRoute(this.closedNodes(nodeId))) return 'wouldBlockAllRoutes';
    return null;
  }

  private createDefense(
    type: SimDefenseType,
    nodeId: string,
    spent: number,
    lifetimeSeconds: number | undefined,
  ): DefenseEntity {
    const node = this.graph.node(nodeId);
    const defense = this.entities.create((id): DefenseEntity => ({
      id,
      kind: 'defense',
      defenseTypeId: type.id,
      mobile: type.mobile,
      nodeId: node.id,
      level: 1,
      condition: 100,
      blocking: type.blocksNode && !type.mobile && this.graph.routeNodes.has(node.id),
      priority: 'first',
      focusGroupId: null,
      targetGroupId: null,
      order: type.mobile ? { type: 'guard', nodeId: node.id } : null,
      boosted: false,
      disrupted: false,
      statuses: [],
      expiresAtTick: lifetimeSeconds ? this.tickCount + secondsToTicks(lifetimeSeconds) : null,
      spent,
      x: node.x,
      z: node.z,
    }));
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
    return defense;
  }

  private canPlace(type: SimDefenseType, nodeId: string): boolean {
    const node = this.graph.node(nodeId);
    const onRoute = this.graph.routeNodes.has(nodeId);
    const spawn = this.isSpawn(nodeId);
    if (type.mobile) return onRoute && !spawn;
    const objective = nodeId === this.setup.level.objective.nodeId;
    const routeOk = onRoute && !spawn && !objective;
    if (type.placement === 'buildZone') return node.buildable === true;
    if (type.placement === 'routeNode') return routeOk;
    return node.buildable === true || routeOk;
  }

  private isSpawn(nodeId: string): boolean {
    return (
      this.graph.node(nodeId).kind === 'spawn' ||
      [...this.graph.routes.values()].some((route) => route.nodes[0] === nodeId)
    );
  }

  private orderDefense(command: OrderDefenseCommand): string | null {
    const defense = this.ownDefense(command.defenseId);
    if (!defense) return 'unknownDefense';
    if (!defense.mobile) return 'notMobile';
    const order: DefenseOrder = command.order;
    const targets = order.type === 'guard' ? [order.nodeId] : order.type === 'patrol' ? order.nodeIds : [];
    if (targets.length === 0) return 'invalidOrder';
    const type = this.defenseType(defense);
    for (const id of targets)
      if (!this.graph.nodes.has(id) || !this.canPlace(type, id)) return 'invalidOrder';
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
    defense.order =
      order.type === 'guard'
        ? { type: 'guard', nodeId: order.nodeId }
        : { type: 'patrol', nodeIds: [order.nodeIds[0], order.nodeIds[1]] };
    return null;
  }

  private focusDefense(command: FocusDefenseCommand): string | null {
    const group = this.ownGroup(command.groupId);
    if (!group) return 'unknownGroup';
    if (command.defenseId === null) {
      this.setFocus(group, null);
      return null;
    }
    if (!ON_FIELD.has(group.state) || group.state === 'atObjective') return 'cannotDismantle';
    const data = this.data(group);
    if (data.unit.dismantle <= 0) return 'cannotDismantle';
    const sight = this.sightRange(group);
    const candidates = this.defenses().filter(
      (d) =>
        this.defenseType(d).dismantlable &&
        (this.visibleToAttacker.has(d.id) || this.seenDefenses.has(d.id)) &&
        distance(d, group) <= sight,
    );
    let target: DefenseEntity | undefined;
    if (command.defenseId !== undefined) {
      const chosen = this.ownDefense(command.defenseId);
      if (!chosen || !(this.visibleToAttacker.has(chosen.id) || this.seenDefenses.has(chosen.id)))
        return 'notVisible';
      if (!this.defenseType(chosen).dismantlable) return 'notDismantlable';
      if (!candidates.includes(chosen)) return 'outOfRange';
      target = chosen;
    } else {
      for (const d of candidates) if (!target || distance(d, group) < distance(target, group)) target = d;
      if (!target) return 'noDefenseInSight';
    }
    this.setFocus(group, target.id);
    return null;
  }

  private setFocus(group: GroupEntity, defenseId: number | null): void {
    if (group.focusDefenseId === defenseId) return;
    group.focusDefenseId = defenseId;
    if (defenseId === null && group.state === 'dismantling') group.state = 'moving';
    this.events.push({ tick: this.tickCount, type: 'groupFocusDefense', groupId: group.id, defenseId });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Abilities and command slots

  private useAbility(command: UseAbilityCommand): string | null {
    const ability = this.abilities[command.side]?.get(command.abilityId);
    if (!ability) return 'unknownAbility';
    const reason = this.useAction(command.side, ability, command, null);
    if (reason) return reason;
    if (command.side === 'defender') this.stats.defender.abilitiesUsed++;
    this.events.push({
      tick: this.tickCount,
      type: 'abilityUsed',
      side: command.side,
      abilityId: ability.id,
    });
    return null;
  }

  private useCommand(command: UseCommandCommand): string | null {
    const action = this.slotCommands[command.side]?.get(command.commandId);
    if (!action) return 'unknownCommand';
    if (action.order) return 'orderCommand';
    let anchor: MatchEntity | undefined;
    if (command.side === 'attacker') {
      anchor = command.groupId === undefined ? undefined : this.ownGroup(command.groupId);
      if (!anchor || anchor.state === 'waiting' || anchor.state === 'retreating') return 'unknownGroup';
    } else {
      anchor = command.defenseId === undefined ? undefined : this.ownDefense(command.defenseId);
      if (!anchor) return 'unknownDefense';
    }
    const reason = this.useAction(command.side, action, {}, anchor);
    if (reason) return reason;
    this.events.push({
      tick: this.tickCount,
      type: 'commandUsed',
      side: command.side,
      commandId: action.id,
      entityId: anchor.id,
    });
    return null;
  }

  /**
   * Uses an ability (aimed by the command's fields) or a command slot (aimed from `anchor`, the selected group or
   * asset). Nothing is spent when it is rejected.
   */
  private useAction(
    side: Side,
    action: SimAbility,
    aim: Partial<Pick<UseAbilityCommand, 'x' | 'z' | 'groupId' | 'routeId' | 'nodeId'>>,
    anchor: MatchEntity | null,
  ): string | null {
    if (this.phase === 'ended') return 'ended';
    if ((this.cooldownUntil[side].get(action.id) ?? 0) > this.tickCount) return 'cooldown';
    if (action.cost > this.points[side]) return 'notEnoughPoints';
    const target = this.resolveTarget(side, action, aim, anchor);
    if (typeof target === 'string') return target;
    const until = this.tickCount + Math.max(1, secondsToTicks(action.durationSeconds));
    const run: (() => void)[] = [];
    const lasting: SimEffect[] = [];
    for (const effect of action.effects) {
      const planned = this.planEffect(side, action, effect, target, until);
      if (planned === KEEP) lasting.push(effect);
      else if (typeof planned === 'string') return planned;
      else run.push(planned);
    }
    this.points[side] -= action.cost;
    this.cooldownUntil[side].set(action.id, this.tickCount + secondsToTicks(action.cooldownSeconds));
    for (const step of run) step();
    if (lasting.length > 0)
      this.zones.push({
        abilityId: action.id,
        side,
        selector: target.selector,
        effects: lasting,
        untilTick: until,
        x: target.at.x,
        z: target.at.z,
        radius:
          target.selector.kind === 'area'
            ? target.selector.radius
            : target.selector.kind === 'route'
              ? target.selector.radius
              : 0,
      });
    return null;
  }

  /** Where an ability or command works, checked against the rules; returns a rejection reason otherwise. */
  private resolveTarget(
    side: Side,
    action: SimAbility,
    aim: Partial<Pick<UseAbilityCommand, 'x' | 'z' | 'groupId' | 'routeId' | 'nodeId'>>,
    anchor: MatchEntity | null,
  ): { selector: Selector; at: Point; group?: GroupEntity; nodeId?: string; routeId?: string } | string {
    const centre = this.graph.node(this.setup.level.objective.nodeId);
    if (anchor) {
      // Command slots work on the group or asset they come from, or around it.
      if (action.target === 'area')
        return { selector: { kind: 'area', x: anchor.x, z: anchor.z, radius: action.range }, at: anchor };
      if (action.target === 'self') return { selector: { kind: 'all' }, at: anchor };
      if (action.target === 'unit')
        return {
          selector: { kind: 'entity', id: anchor.id },
          at: anchor,
          ...(anchor.kind === 'group' ? { group: anchor } : {}),
        };
      return 'invalidTarget';
    }
    switch (action.target) {
      case 'self':
        return { selector: { kind: 'all' }, at: centre };
      case 'area': {
        if (!Number.isFinite(aim.x) || !Number.isFinite(aim.z)) return 'missingTarget';
        const at = { x: aim.x as number, z: aim.z as number };
        return { selector: { kind: 'area', ...at, radius: action.range }, at };
      }
      case 'junction': {
        let nodeId = aim.nodeId;
        if (nodeId === undefined && Number.isFinite(aim.x) && Number.isFinite(aim.z)) {
          const at = { x: aim.x as number, z: aim.z as number };
          let best: { id: string; d: number } | null = null;
          for (const id of this.graph.routeNodes) {
            const d = distance(this.graph.node(id), at);
            if (!best || d < best.d) best = { id, d };
          }
          if (best && best.d <= 4) nodeId = best.id;
        }
        if (!nodeId || !this.graph.routeNodes.has(nodeId)) return 'missingTarget';
        // Junction abilities work on the way, not where groups enter the map or on the objective itself.
        if (this.isSpawn(nodeId) || nodeId === this.setup.level.objective.nodeId) return 'invalidTarget';
        const node = this.graph.node(nodeId);
        const radius = action.range > 0 ? action.range : JUNCTION_EFFECT_REACH;
        return { selector: { kind: 'area', x: node.x, z: node.z, radius }, at: node, nodeId };
      }
      case 'route': {
        const routeId = aim.routeId;
        if (!routeId || !this.graph.routes.has(routeId)) return 'unknownRoute';
        const radius = action.range > 0 ? action.range : ROUTE_EFFECT_REACH;
        let group: GroupEntity | undefined;
        if (aim.groupId !== undefined) {
          group = this.ownGroup(aim.groupId);
          if (!group || group.state === 'waiting') return 'unknownGroup';
        }
        const path = this.routePoints.get(routeId) as Point[];
        const middle = pointOnPolyline(path, polylineLength(path) / 2);
        return {
          selector: { kind: 'route', routeId, radius },
          at: middle,
          routeId,
          ...(group ? { group } : {}),
        };
      }
      case 'unit': {
        if (aim.groupId === undefined) return 'missingTarget';
        const group = this.ownGroup(aim.groupId);
        if (!group || group.state === 'waiting') return 'unknownGroup';
        if (side === 'defender') {
          if (group.detection === 'unknown') return 'notVisible';
          if (action.range > 0 && !this.activeDefenses().some((d) => distance(d, group) <= action.range))
            return 'outOfRange';
        }
        return { selector: { kind: 'entity', id: group.id }, at: group, group };
      }
    }
  }

  /**
   * Checks one effect and returns what to do: `KEEP` for effects kept by the zone, a step to run once, or a rejection
   * reason.
   */
  private planEffect(
    side: Side,
    action: SimAbility,
    effect: SimEffect,
    target: { selector: Selector; at: Point; group?: GroupEntity; nodeId?: string; routeId?: string },
    until: number,
  ): typeof KEEP | (() => void) | string {
    const magnitude = effect.magnitude ?? DEFAULT_EFFECT_MAGNITUDE;
    const kind = recipientsOf(side, effect.type);
    if (target.selector.kind === 'entity' && kind !== null) {
      const entity = this.entities.get(target.selector.id);
      if (!entity || (kind === 'groups') !== (entity.kind === 'group')) return 'invalidTarget';
    }
    if (LASTING.has(effect.type)) {
      if (kind === null) return 'invalidTarget';
      return KEEP;
    }
    switch (effect.type) {
      case 'disrupt': {
        // Sabotage needs one of the Attacker's groups close enough to reach the asset.
        if (
          side === 'attacker' &&
          target.selector.kind !== 'entity' &&
          !this.groupNear(target.at, action.range)
        )
          return 'noGroupNear';
        return () => {
          for (const entity of this.covered(target.selector, kind as 'groups' | 'defenses', effect)) {
            if (entity.kind === 'defense') this.sabotage(entity, action.durationSeconds);
            else this.status.apply(entity.id, 'pinned', until, 1, this.tickCount);
          }
        };
      }
      case 'dismantle': {
        if (side !== 'attacker') return 'invalidTarget';
        if (target.selector.kind !== 'entity' && !this.groupNear(target.at, action.range))
          return 'noGroupNear';
        return () => {
          for (const entity of this.covered(target.selector, 'defenses', effect))
            if (entity.kind === 'defense' && this.defenseType(entity).dismantlable)
              this.wearDefense(entity, effect.magnitude ?? 50, null);
        };
      }
      case 'move': {
        if (side !== 'attacker') return 'invalidTarget';
        const group = target.group;
        if (!group) return 'missingTarget';
        const routeId = target.routeId;
        if (!routeId) return 'unknownRoute';
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
          this.data(group).switchNodeId = null;
          this.data(group).holdNodeId = null;
        };
      }
      case 'spawn':
        return this.planSpawn(side, action, effect, target);
      case 'blockBranch': {
        if (side !== 'defender') return 'invalidTarget';
        const nodeId = target.nodeId ?? this.nearestRouteNode(target.at);
        if (!nodeId || this.isSpawn(nodeId) || nodeId === this.setup.level.objective.nodeId)
          return 'notBuildable';
        const closed = this.closedNodes(nodeId);
        if (!this.graph.hasOpenRoute(closed)) return 'wouldBlockAllRoutes';
        return () => {
          this.closures.set(nodeId, Math.max(this.closures.get(nodeId) ?? 0, until));
          this.events.push({ tick: this.tickCount, type: 'branchClosed', nodeId, untilTick: until });
        };
      }
      case 'resource':
        return () => {
          if (effect.pool === 'points') this.points[side] += magnitude;
          else this.resources[side] += magnitude;
        };
      default:
        return 'unsupportedEffect';
    }
  }

  private planSpawn(
    side: Side,
    action: SimAbility,
    effect: SimEffect,
    target: { selector: Selector; at: Point; nodeId?: string; routeId?: string },
  ): (() => void) | string {
    if (side === 'defender') {
      const type = effect.spawn ? this.defenseTypes.get(effect.spawn) : undefined;
      if (!type) return 'unknownDefense';
      const nodeId = target.nodeId ?? this.nearestRouteNode(target.at);
      if (!nodeId) return 'notBuildable';
      const where = this.checkSite(type, nodeId);
      if (where) return where;
      const lifetime = action.durationSeconds > 0 ? action.durationSeconds : type.lifetimeSeconds;
      return () => {
        this.createDefense(type, nodeId, 0, lifetime);
      };
    }
    const unit = effect.spawn ? this.unitTypes.get(effect.spawn) : undefined;
    if (!unit) return 'unknownUnit';
    const routeId = target.routeId ?? this.setup.level.routes[0]?.id;
    if (!routeId) return 'unknownRoute';
    const count = Math.max(1, Math.round(effect.magnitude ?? 1));
    if (unit.capacity * count > this.capacityRemaining) return 'notEnoughCapacity';
    return () => {
      this.capacityRemaining -= unit.capacity * count;
      this.stats.attacker.capacityUsed += unit.capacity * count;
      const waveId = this.nextWaveId++;
      const group = this.createGroup(waveId, unit, count, routeId, 'column', 0, new Set(this.usedRoutes));
      this.waves.set(waveId, { groupIds: [group.id], members: count, turnedBack: 0 });
    };
  }

  /** The things a selector covers that an effect works on (and whose condition holds). */
  private covered(selector: Selector, kind: 'groups' | 'defenses', effect: SimEffect): MatchEntity[] {
    const pool: MatchEntity[] = kind === 'groups' ? this.fieldGroups() : this.defenses();
    return pool.filter((entity) => {
      if (effect.condition === 'atObjective' && (entity.kind !== 'group' || entity.state !== 'atObjective'))
        return false;
      if (effect.condition === 'knownRoute' && (entity.kind !== 'group' || !this.data(entity).knownRoute))
        return false;
      switch (selector.kind) {
        case 'all':
          return true;
        case 'entity':
          return entity.id === selector.id;
        case 'area':
          return distance(entity, selector) <= selector.radius;
        case 'route':
          return entity.kind === 'group'
            ? entity.routeId === selector.routeId
            : distanceToPolyline(entity, this.routePoints.get(selector.routeId) as Point[]) <=
                selector.radius;
      }
    });
  }

  /** Every tick, lasting effects refresh the statuses of everything their zone covers. */
  private applyZones(): void {
    for (const zone of this.zones) {
      for (const effect of zone.effects) {
        const kind = recipientsOf(zone.side, effect.type);
        if (!kind) continue;
        const magnitude = effect.magnitude;
        for (const entity of this.covered(zone.selector, kind, effect)) {
          switch (effect.type) {
            case 'slow':
              this.status.apply(
                entity.id,
                'slowed',
                zone.untilTick,
                magnitude ?? DEFAULT_EFFECT_MAGNITUDE,
                this.tickCount,
              );
              break;
            case 'reveal':
              this.status.apply(entity.id, 'revealed', zone.untilTick, 1, this.tickCount);
              break;
            case 'conceal':
              this.status.apply(
                entity.id,
                'concealed',
                zone.untilTick,
                magnitude ?? DEFAULT_CONCEAL,
                this.tickCount,
              );
              break;
            case 'protect':
              this.status.apply(
                entity.id,
                'protected',
                zone.untilTick,
                magnitude ?? DEFAULT_PROTECT,
                this.tickCount,
              );
              break;
            case 'boost':
              // A plain boost of the Defender works on mobile assets (they move and press harder).
              if (entity.kind === 'defense' && !effect.stat && !entity.mobile) break;
              this.status.apply(
                entity.id,
                boostKey(effect),
                zone.untilTick,
                magnitude ?? DEFAULT_EFFECT_MAGNITUDE,
                this.tickCount,
              );
              break;
            default:
              break;
          }
        }
      }
    }
  }

  private groupNear(at: Point, range: number): boolean {
    return this.fieldGroups().some((g) => distance(g, at) <= Math.max(range, this.sightRange(g)));
  }

  private nearestRouteNode(at: Point): string | null {
    let best: { id: string; d: number } | null = null;
    for (const id of this.graph.routeNodes) {
      if (this.isSpawn(id) || id === this.setup.level.objective.nodeId) continue;
      const d = distance(this.graph.node(id), at);
      if (!best || d < best.d) best = { id, d };
    }
    return best?.id ?? null;
  }

  /** Sabotage: the asset is out of action for a while (shorter when protected). */
  private sabotage(defense: DefenseEntity, seconds: number): void {
    if (!this.defenseType(defense).disruptible) return;
    const protect = this.defenseProtection(defense);
    const ticks = Math.max(1, secondsToTicks(seconds * (1 - protect)));
    this.status.apply(defense.id, 'disrupted', this.tickCount + ticks, 1, this.tickCount);
    if (!this.sabotaged.has(defense.id)) {
      this.sabotaged.add(defense.id);
      defense.targetGroupId = null;
      this.stats.attacker.defensesDisrupted++;
      this.events.push({
        tick: this.tickCount,
        type: 'defenseDisrupted',
        defenseId: defense.id,
        by: 'sabotage',
      });
    }
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

  /** Ended zones, closures, sabotage and temporary assets. */
  private expireEffects(): void {
    this.zones = this.zones.filter((zone) => zone.untilTick > this.tickCount);
    for (const [nodeId, until] of this.closures) {
      if (until > this.tickCount) continue;
      this.closures.delete(nodeId);
      this.events.push({ tick: this.tickCount, type: 'branchOpened', nodeId });
    }
    for (const id of this.sabotaged) {
      if (this.status.active(id, 'disrupted', this.tickCount)) continue;
      this.sabotaged.delete(id);
      if (this.entities.get(id))
        this.events.push({ tick: this.tickCount, type: 'defenseRecovered', defenseId: id });
    }
    for (const defense of this.defenses()) {
      if (defense.expiresAtTick === null || defense.expiresAtTick > this.tickCount) continue;
      this.removeDefense(defense);
      this.events.push({ tick: this.tickCount, type: 'defenseExpired', defenseId: defense.id });
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
    const closed = this.blockers();
    for (const group of this.groups()) {
      if (group.state !== 'blocked') continue;
      const data = this.data(group);
      if (data.blockedAt !== null && closed.has(data.blockedAt)) {
        data.blockedBy = closed.get(data.blockedAt)?.id ?? null;
        continue;
      }
      data.blockedAt = null;
      data.blockedBy = null;
      group.state = 'moving';
    }
  }

  private moveGroups(): void {
    const closed = this.blockers();
    this.measureCrossings();
    for (const group of this.groups()) {
      if (group.state !== 'moving' && group.state !== 'retreating') continue;
      if (this.status.active(group.id, 'pinned', this.tickCount)) continue;
      const data = this.data(group);
      let speed =
        data.unit.speed *
        data.speedVariation *
        FORMATIONS[this.formationOf(group)].speed *
        groundSpeed(this.groundUnder(group), data.unit) *
        crowdSpeed(data.queued ? 0 : data.crowd) *
        (1 - this.slowOf(group));
      speed *= 1 + this.groupBoost(group, 'speed');
      speed *= 1 + this.passive('attacker', 'boost', 'speed', group);
      const step = speed * TICK_SECONDS;
      if (group.state === 'retreating') this.walkBack(group, step);
      else this.walkForward(group, step, closed);
      if (this.entities.get(group.id)) this.placeGroup(group);
    }
  }

  /** The ground of the leg a group is on. */
  private groundUnder(group: GroupEntity) {
    const legs = this.graph.routeLegs(group.routeId);
    return groundOf(this.setup.level, legs[Math.min(group.leg, legs.length - 1)]?.terrain ?? 'cover');
  }

  /** The leg a group is on, when that leg is a narrow crossing. */
  private crossingLeg(group: GroupEntity): Leg | null {
    const leg = this.graph.routeLegs(group.routeId)[group.leg];
    return leg?.capacity !== undefined ? leg : null;
  }

  /** On a narrow crossing every group moves as a column (Route Capacity: no room to spread out). */
  private formationOf(group: GroupEntity): GroupEntity['formation'] {
    const data = this.data(group);
    return data.crossing !== null && !data.queued ? 'column' : group.formation;
  }

  private loadOf(group: GroupEntity): number {
    return group.count * this.data(group).unit.capacity;
  }

  /**
   * Route Capacity: what stands on each narrow crossing this tick. A group is on a crossing once it has stepped onto
   * it; a group at the near end of one waits there while the crossing is full (see `walkForward`).
   */
  private measureCrossings(): void {
    this.crossingLoad = new Map();
    const onField = this.groups().filter((g) => ON_FIELD.has(g.state) || g.state === 'retreating');
    for (const group of onField) {
      const leg = this.crossingLeg(group);
      if (!leg || (group.legDistance <= 0 && group.state !== 'retreating')) continue;
      this.crossingLoad.set(leg.edgeKey, (this.crossingLoad.get(leg.edgeKey) ?? 0) + this.loadOf(group));
    }
    for (const group of this.groups()) {
      const data = this.data(group);
      const leg = ON_FIELD.has(group.state) || group.state === 'retreating' ? this.crossingLeg(group) : null;
      data.crossing = leg?.edgeKey ?? null;
      data.queued = false;
      data.crowd = leg ? crowding(this.crossingLoad.get(leg.edgeKey) ?? 0, leg.capacity as number) : 0;
      // Waiting at the near end: packed with what is on the crossing, but not on it yet.
      if (leg && group.legDistance <= 0 && group.state !== 'retreating') {
        const load = this.crossingLoad.get(leg.edgeKey) ?? 0;
        data.queued = load > 0 && load + this.loadOf(group) > (leg.capacity as number);
        if (!data.queued) data.crowd = crowding(load + this.loadOf(group), leg.capacity as number);
      }
    }
  }

  /** Strongest slow on a group: from effects, or from a slowing structure in reach. */
  private slowOf(group: GroupEntity): number {
    let slow = this.status.magnitude(group.id, 'slowed', this.tickCount);
    for (const defense of this.activeDefenses()) {
      const type = this.defenseType(defense);
      if (type.slow > 0 && distance(defense, group) <= this.reach(defense)) slow = Math.max(slow, type.slow);
    }
    return Math.min(0.9, slow);
  }

  private walkForward(group: GroupEntity, step: number, closed: Map<string, DefenseEntity | null>): void {
    let remaining = step;
    while (remaining > 0 && group.state === 'moving') {
      const legs = this.graph.routeLegs(group.routeId);
      const leg = legs[group.leg];
      if (!leg) return;
      // Route Capacity: a group steps onto a narrow crossing only when it is empty or the group still fits.
      if (leg.capacity !== undefined && group.legDistance <= 0) {
        const load = this.crossingLoad.get(leg.edgeKey) ?? 0;
        const data = this.data(group);
        if (load > 0 && load + this.loadOf(group) > leg.capacity) {
          data.crossing = leg.edgeKey;
          data.queued = true;
          data.crowd = crowding(load + this.loadOf(group), leg.capacity);
          return;
        }
        this.crossingLoad.set(leg.edgeKey, load + this.loadOf(group));
      }
      const blocked = closed.has(leg.to);
      const limit = blocked ? Math.max(group.legDistance, leg.length - BLOCK_STANDOFF) : leg.length;
      if (group.legDistance + remaining < limit) {
        group.legDistance += remaining;
        return;
      }
      remaining -= limit - group.legDistance;
      group.legDistance = limit;
      if (blocked) {
        const blocker = closed.get(leg.to) ?? null;
        group.state = 'blocked';
        this.data(group).blockedAt = leg.to;
        this.data(group).blockedBy = blocker?.id ?? null;
        this.events.push({
          tick: this.tickCount,
          type: 'groupBlocked',
          groupId: group.id,
          nodeId: leg.to,
          defenseId: blocker?.id ?? null,
        });
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
    const switchHere = data.switchNodeId === null || data.switchNodeId === nodeId;
    if (group.pendingRouteId && switchHere && this.canSwitchAt(group, group.pendingRouteId)) {
      this.switchRoute(group, group.pendingRouteId);
      group.pendingRouteId = null;
    }
    const holdHere = data.holdNodeId === null || data.holdNodeId === nodeId;
    if (group.holdAtJunction && holdHere && this.graph.junctions.has(nodeId)) {
      group.holdAtJunction = false;
      data.holdNodeId = null;
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
    this.data(group).switchNodeId = null;
    this.events.push({ tick: this.tickCount, type: 'groupRerouted', groupId: group.id, routeId });
    return true;
  }

  private junctionAhead(group: GroupEntity): boolean {
    return this.nodesAhead(group).some((id) => this.graph.junctions.has(id));
  }

  /** Nodes still ahead of a group on its route, without the objective at the end. */
  private nodesAhead(group: GroupEntity): string[] {
    const nodes = (this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes;
    return nodes.slice(group.leg + 1, -1);
  }

  private rerouteNodeAhead(group: GroupEntity, routeId: string): boolean {
    const nodes = (this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes;
    const target = (this.graph.routes.get(routeId) as { nodes: string[] }).nodes;
    return nodes
      .slice(group.leg + 1, -1)
      .some((id) => target.indexOf(id) >= 0 && target.indexOf(id) < target.length - 1);
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
    group.focusDefenseId = null;
    Object.assign(this.data(group), {
      blockedAt: null,
      blockedBy: null,
      holdNodeId: null,
      switchNodeId: null,
    });
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
    this.events.push({
      tick: this.tickCount,
      type: 'groupLeft',
      groupId: group.id,
      count: group.count,
      refundCapacity,
      refundSupplies,
    });
  }

  private placeGroup(group: GroupEntity): void {
    const legs = this.graph.routeLegs(group.routeId);
    const leg = legs[group.leg];
    const end = this.graph.node(
      (this.graph.routes.get(group.routeId) as { nodes: string[] }).nodes.at(-1) as string,
    );
    const at = leg ? pointOnPolyline(leg.points, group.legDistance) : end;
    group.x = at.x;
    group.z = at.z;
  }

  private movePatrols(): void {
    for (const defense of this.defenses()) {
      if (!defense.mobile) continue;
      if (defense.targetGroupId !== null) continue; // engaging: stays put while intercepting
      if (!this.isActive(defense)) continue;
      const patrol = this.patrolData.get(defense.id) as PatrolInternals;
      const type = this.defenseType(defense);
      const boost = Math.max(
        this.status.magnitude(defense.id, 'boost:plain', this.tickCount),
        this.status.magnitude(defense.id, 'boost:speed', this.tickCount),
      );
      let remaining = type.speed * (1 + boost) * TICK_SECONDS;
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

  /**
   * The Defender detects a group within a defense's detection distance, shortened by the group's visibility:
   * Concealed and Stealth units, concealment effects and the Photographer's Low Profile. Sensors ignore all of that;
   * a revealed group is detected anywhere. Stealth is never permanent (spec §8).
   */
  private updateDetection(): void {
    const detectionBonus = 1 + this.passive('defender', 'boost', 'detectionRange');
    const lowProfile = Math.min(0.9, this.passive('attacker', 'conceal'));
    const defenses = this.activeDefenses();
    for (const group of this.groups()) {
      if (group.state === 'waiting') continue;
      const data = this.data(group);
      const plain = FORMATIONS[this.formationOf(group)].detection * this.groundUnder(group).detection;
      const hidden =
        VISIBILITY_FACTORS[data.unit.visibility] *
        (1 - this.status.magnitude(group.id, 'concealed', this.tickCount)) *
        (1 - lowProfile);
      const exposure = this.vision.exposureAt(group);
      const seen =
        this.status.active(group.id, 'revealed', this.tickCount) ||
        defenses.some(
          (d) =>
            this.vision.sees(
              d,
              group,
              this.detectionRange(d) *
                this.vision.vantageAt(d) *
                detectionBonus *
                plain *
                exposure *
                (this.defenseType(d).seesHidden ? 1 : hidden),
            ) || this.touching(d, group),
        );
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

  /**
   * The Attacker sees a defense while one of its groups is close enough, or a reveal ability covers it. One hidden in
   * an Ambush Zone is only spotted from much closer, and Close Contact does not give it away.
   */
  private updateAttackerSight(): void {
    this.seenLastTick = new Set(this.visibleToAttacker);
    this.visibleToAttacker.clear();
    const lookers = this.groups().filter((g) => g.state !== 'waiting');
    for (const defense of this.defenses()) {
      const revealed = this.status.active(defense.id, 'revealed', this.tickCount);
      const cover = 1 - this.status.magnitude(defense.id, 'concealed', this.tickCount);
      const lurking = this.vision.ambushAt(defense);
      const inSight =
        revealed ||
        lookers.some((g) =>
          lurking
            ? this.spotsLurking(g, defense, cover)
            : this.inSight(g, defense, cover) || this.touching(g, defense),
        );
      if (!inSight) continue;
      this.visibleToAttacker.add(defense.id);
      if (!this.seenDefenses.has(defense.id))
        this.events.push({ tick: this.tickCount, type: 'defenseSeen', defenseId: defense.id });
      if (!defense.mobile) this.seenDefenses.set(defense.id, { ...defense });
    }
    // A remembered structure that is gone is forgotten once a group sees the spot again.
    for (const [id, memory] of this.seenDefenses) {
      if (this.entities.get(id)) continue;
      if (lookers.some((g) => this.inSight(g, memory))) this.seenDefenses.delete(id);
    }
  }

  /** Whether a group sees a spot: its sight range, from a vantage point further, cut by what the line crosses. */
  private inSight(group: GroupEntity, at: Point, cover = 1): boolean {
    return this.vision.sees(group, at, this.sightRange(group) * this.vision.vantageAt(group) * cover);
  }

  /**
   * Whether a group spots an asset waiting in an Ambush Zone: only within a share of its sight range, whatever brush
   * the line passes (the thicket's cover is already counted in that share), and never through a wall.
   */
  private spotsLurking(group: GroupEntity, at: Point, cover: number): boolean {
    const range = this.sightRange(group) * this.vision.vantageAt(group) * cover * AMBUSH_SIGHT;
    return distance(group, at) <= range && !this.vision.blocked(group, at);
  }

  /** Close Contact: within the contact range two sides see each other past any cover, though not through a wall. */
  private touching(a: Point, b: Point): boolean {
    return inContact(this.setup.level.closeContact, distance(a, b)) && !this.vision.blocked(a, b);
  }

  private sightRange(group: GroupEntity): number {
    const unit = this.data(group).unit;
    return (
      unit.sightRange *
      (1 + this.passive('attacker', 'boost', 'sightRange', group) + this.groupBoost(group, 'sightRange'))
    );
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Pressure, dismantling and objective

  private applyPressure(): void {
    for (const defense of this.defenses()) {
      defense.targetGroupId = null;
      if (!this.isActive(defense)) continue;
      const reach = this.reach(defense);
      const candidates = this.groups().filter(
        (g) =>
          ON_FIELD.has(g.state) &&
          g.detection !== 'unknown' &&
          distance(g, defense) <= reach &&
          !this.vision.blocked(defense, g),
      );
      if (defense.focusGroupId !== null && !this.entities.get(defense.focusGroupId))
        defense.focusGroupId = null;
      const target =
        candidates.find((g) => g.id === defense.focusGroupId) ?? this.pickTarget(defense, candidates);
      if (!target) continue;
      defense.targetGroupId = target.id;
      if (this.pressurePerSecondFor(defense) > 0) this.springAmbush(defense, target);
      let pressure = this.pressurePerSecondFor(defense);
      // Close Contact: stronger up close, weaker from further away.
      pressure *= contactFactor(this.setup.level.closeContact, distance(defense, target));
      pressure *= 1 + this.status.magnitude(defense.id, 'boost:pressure', this.tickCount);
      if (defense.mobile) pressure *= 1 + this.status.magnitude(defense.id, 'boost:plain', this.tickCount);
      // Packed on a full crossing, the groups next to the target take part of it too (Route Capacity).
      const crossing = this.packed(target) ? this.data(target).crossing : null;
      this.press(target, pressure, defense);
      if (crossing === null) continue;
      for (const other of this.groups()) {
        if (other === target || !this.entities.get(other.id) || !ON_FIELD.has(other.state)) continue;
        if (other.detection === 'unknown' || this.data(other).crossing !== crossing || !this.packed(other))
          continue;
        this.press(other, pressure * CROWD_SPLASH, defense);
      }
    }
  }

  private pressurePerSecondFor(defense: DefenseEntity): number {
    return this.defenseType(defense).pressurePerSecond * (1 + UPGRADE_PRESSURE_BONUS * (defense.level - 1));
  }

  /**
   * Ambush Zones: an asset hidden in one that the Attacker had not seen catches each group by surprise once. The group
   * stops for a moment and takes more pressure for a few seconds.
   */
  private springAmbush(defense: DefenseEntity, group: GroupEntity): void {
    if (!this.vision.ambushAt(defense) || this.seenLastTick.has(defense.id)) return;
    const key = `${defense.id}:${group.id}`;
    if (this.ambushes.has(key)) return;
    this.ambushes.add(key);
    const tick = this.tickCount;
    this.status.apply(group.id, 'pinned', tick + secondsToTicks(AMBUSH_PIN_SECONDS), 1, tick);
    this.status.apply(group.id, 'ambushed', tick + secondsToTicks(AMBUSH_SECONDS), AMBUSH_PRESSURE, tick);
    this.events.push({ tick, type: 'groupAmbushed', groupId: group.id, byDefenseId: defense.id });
  }

  /** A group squeezed on (or queued at) a crossing that is over its capacity. */
  private packed(group: GroupEntity): boolean {
    const data = this.data(group);
    return data.crossing !== null && (data.queued || data.crowd > 1);
  }

  private press(target: GroupEntity, pressure: number, defense: DefenseEntity): void {
    const protect = this.status.magnitude(target.id, 'protected', this.tickCount);
    const crowded = this.packed(target) ? 1 + CROWD_PRESSURE_TAKEN : 1;
    const surprised = 1 + this.status.magnitude(target.id, 'ambushed', this.tickCount);
    target.pressure +=
      pressure *
      FORMATIONS[this.formationOf(target)].pressureTaken *
      crowded *
      surprised *
      (1 - protect) *
      TICK_SECONDS;
    this.turnBackMembers(target, defense);
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
      this.events.push({
        tick: this.tickCount,
        type: 'memberTurnedBack',
        groupId: group.id,
        byDefenseId: defense.id,
        remaining: group.count,
      });
    }
    if (group.count > 0) return;
    this.removeGroup(group);
    this.events.push({
      tick: this.tickCount,
      type: 'groupStopped',
      groupId: group.id,
      byDefenseId: defense.id,
    });
    const wave = this.waves.get(group.waveId) as WaveRecord;
    const waveGone = wave.groupIds.every((id) => !this.entities.get(id));
    if (waveGone && wave.turnedBack === wave.members) {
      const waveBonus = this.setup.level.bonuses.waveStopped;
      this.resources.defender += waveBonus;
      this.stats.defender.wavesStopped++;
      this.events.push({ tick: this.tickCount, type: 'waveStopped', waveId: group.waveId, bonus: waveBonus });
    }
  }

  /**
   * Groups pushing against a roadblock wear it down (and take it apart faster with a dismantle rate); at 0 condition
   * it is disrupted, or removed when it can be dismantled.
   */
  private wearRoadblocks(): void {
    for (const group of this.groups()) {
      if (group.state !== 'blocked') continue;
      const blocker = this.entities.get(this.data(group).blockedBy ?? -1);
      if (!blocker || blocker.kind !== 'defense' || !blocker.blocking) continue;
      const type = this.defenseType(blocker);
      let wear = type.wearPerMemberSecond * group.count;
      if (type.dismantlable) wear += this.dismantleRate(group);
      this.wearDefense(blocker, wear * (1 - this.defenseProtection(blocker)) * TICK_SECONDS, group.id, true);
    }
  }

  /** Focus Defense: a group with a dismantle rate stops next to its target and takes it apart. */
  private workOnDefenses(): void {
    for (const group of this.groups()) {
      if (group.focusDefenseId === null) continue;
      const target = this.entities.get(group.focusDefenseId);
      if (!target || target.kind !== 'defense' || group.state === 'retreating') {
        this.setFocus(group, null);
        continue;
      }
      if (group.state === 'atObjective' || group.state === 'waiting') continue;
      if (distance(group, target) > DISMANTLE_REACH) continue;
      if (group.state === 'moving' || group.state === 'holding') group.state = 'dismantling';
      if (group.state !== 'dismantling') continue;
      const wear = this.dismantleRate(group) * (1 - this.defenseProtection(target)) * TICK_SECONDS;
      this.wearDefense(target, wear, group.id);
      if (!this.entities.get(target.id) || target.condition <= 0) this.setFocus(group, null);
    }
  }

  /** Maintenance assets restore the condition of worn assets in their reach (a disrupted one needs a paid repair). */
  private maintain(): void {
    for (const crew of this.activeDefenses()) {
      const rate = this.defenseType(crew).repairPerSecond;
      if (rate <= 0) continue;
      for (const defense of this.defenses())
        if (defense.condition > 0 && defense.condition < 100 && distance(defense, crew) <= this.reach(crew))
          defense.condition = Math.min(100, defense.condition + rate * TICK_SECONDS);
    }
  }

  private dismantleRate(group: GroupEntity): number {
    const unit = this.data(group).unit;
    return (
      unit.dismantle *
      group.count *
      (1 + this.passive('attacker', 'boost', 'dismantle', group) + this.groupBoost(group, 'dismantle'))
    );
  }

  /**
   * Takes condition off a defense. At 0 a dismantlable asset is removed; any other is disrupted until repaired
   * (a roadblock opens the way).
   */
  private wearDefense(
    defense: DefenseEntity,
    amount: number,
    byGroupId: number | null,
    roadblock = false,
  ): void {
    if (amount <= 0 || defense.condition <= 0) return;
    defense.condition -= amount;
    if (defense.condition > 0) return;
    defense.condition = 0;
    if (this.defenseType(defense).dismantlable) {
      this.removeDefense(defense);
      this.stats.attacker.defensesDismantled++;
      this.events.push({ tick: this.tickCount, type: 'defenseDismantled', defenseId: defense.id, byGroupId });
      return;
    }
    defense.blocking = false;
    defense.targetGroupId = null;
    if (!roadblock) this.stats.attacker.defensesDisrupted++;
    this.events.push({ tick: this.tickCount, type: 'defenseDisrupted', defenseId: defense.id, by: 'worn' });
  }

  /**
   * Hold progress grows while a group is in the zone (faster for units built for it, and with hold boosts), at half
   * speed while a Defender patrol contests it; with nobody in the zone it pauses (it never resets).
   */
  private updateObjective(): void {
    const { objective } = this.setup.level;
    const centre = this.graph.node(objective.nodeId);
    let rate = 0;
    for (const group of this.groups()) {
      if (group.state !== 'atObjective') continue;
      const unit = this.data(group).unit;
      const boost = this.groupBoost(group, 'holdRate') + this.passive('attacker', 'boost', 'holdRate', group);
      rate = Math.max(rate, unit.objectiveRate * (1 + boost));
    }
    this.contested = this.activeDefenses().some((d) => d.mobile && distance(d, centre) <= objective.radius);
    if (rate > 0) this.heldTicks += rate * (this.contested ? CONTESTED_HOLD_RATE : 1);
    this.stats.attacker.bestObjectiveProgress = Math.max(
      this.stats.attacker.bestObjectiveProgress,
      Math.min(1, this.heldTicks / this.holdTicksRequired),
    );
    if (this.heldTicks >= this.holdTicksRequired)
      this.end({ winner: 'attacker', reason: 'objectiveCompleted' });
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

  /** Writes the statuses that are active this tick onto the entities, for snapshots. */
  private refreshStatuses(): void {
    const tick = this.tickCount;
    for (const group of this.groups()) {
      const statuses: GroupStatus[] = [];
      const onField = ON_FIELD.has(group.state);
      group.slowed = onField && this.slowOf(group) > 0;
      group.boosted = this.status.anyActive(group.id, 'boost:', tick);
      if (group.slowed) statuses.push('slowed');
      if (group.boosted) statuses.push('boosted');
      if (this.status.active(group.id, 'concealed', tick)) statuses.push('concealed');
      if (this.status.active(group.id, 'revealed', tick)) statuses.push('revealed');
      if (this.status.active(group.id, 'pinned', tick)) statuses.push('pinned');
      if (this.status.active(group.id, 'protected', tick)) statuses.push('protected');
      if (this.entities.get(group.id) && this.packed(group)) statuses.push('crowded');
      if (this.status.active(group.id, 'ambushed', tick)) statuses.push('ambushed');
      group.statuses = statuses;
    }
    for (const defense of this.defenses()) {
      const statuses: DefenseStatus[] = [];
      defense.disrupted = !this.isActive(defense);
      defense.boosted = this.status.anyActive(defense.id, 'boost:', tick);
      if (defense.disrupted) statuses.push('disrupted');
      if (defense.boosted) statuses.push('boosted');
      if (this.status.active(defense.id, 'protected', tick)) statuses.push('protected');
      if (this.status.active(defense.id, 'revealed', tick)) statuses.push('revealed');
      if (this.status.active(defense.id, 'concealed', tick)) statuses.push('concealed');
      if (this.vision.ambushAt(defense) && !this.visibleToAttacker.has(defense.id)) statuses.push('hidden');
      defense.statuses = statuses;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Views

  private viewEntities(viewer: Side | null): MatchEntity[] {
    const out: MatchEntity[] = [];
    for (const entity of this.entities.all()) {
      if (entity.kind === 'group') {
        if (viewer !== 'defender') out.push({ ...entity, statuses: [...entity.statuses] });
        else if (entity.state !== 'waiting' && entity.detection !== 'unknown') {
          const identified = entity.detection === 'identified';
          out.push({
            ...entity,
            unitTypeId: identified ? entity.unitTypeId : '',
            count: identified ? entity.count : 0,
            holdAtJunction: false,
            pendingRouteId: null,
            pressure: 0,
            boosted: false,
            // The Defender sees what its own effects do, not the Attacker's.
            statuses: entity.statuses.filter(
              (s) =>
                s === 'slowed' || s === 'revealed' || s === 'pinned' || s === 'crowded' || s === 'ambushed',
            ),
          });
        }
      } else if (viewer !== 'attacker') {
        out.push({ ...entity, statuses: [...entity.statuses] });
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

  private viewClosures(viewer: Side | null): Closure[] {
    const out: Closure[] = [];
    const lookers = viewer === 'attacker' ? this.fieldGroups() : [];
    for (const [nodeId, until] of this.closures) {
      const node = this.graph.node(nodeId);
      if (viewer === 'attacker' && !lookers.some((g) => this.inSight(g, node))) continue;
      out.push({ nodeId, x: node.x, z: node.z, remainingTicks: until - this.tickCount });
    }
    return out;
  }

  /** The Attacker only learns that the objective is contested by seeing the patrol that contests it. */
  private contestVisibleToAttacker(): boolean {
    const { objective } = this.setup.level;
    const centre = this.graph.node(objective.nodeId);
    return this.activeDefenses().some(
      (d) => d.mobile && this.visibleToAttacker.has(d.id) && distance(d, centre) <= objective.radius,
    );
  }

  private attackerCopy(defense: DefenseEntity, remembered: boolean): DefenseEntity {
    return {
      ...defense,
      priority: 'first',
      focusGroupId: null,
      order: null,
      spent: 0,
      remembered,
      statuses: defense.statuses.filter((s) => s === 'disrupted' || s === 'revealed'),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Helpers

  private removeGroup(group: GroupEntity): void {
    this.entities.remove(group.id);
    this.groupData.delete(group.id);
    this.status.clear(group.id);
    for (const defense of this.defenses()) if (defense.focusGroupId === group.id) defense.focusGroupId = null;
  }

  private removeDefense(defense: DefenseEntity): void {
    this.entities.remove(defense.id);
    this.patrolData.delete(defense.id);
    this.status.clear(defense.id);
    this.sabotaged.delete(defense.id);
  }

  private activeWaveCount(): number {
    let count = 0;
    for (const wave of this.waves.values()) if (wave.groupIds.some((id) => this.entities.get(id))) count++;
    return count;
  }

  /**
   * Nodes the rule counts as closed: roadblocks (also while sabotaged, since they come back) and closed branches,
   * plus `extra` (to test a placement, repair or closure against the rule).
   */
  private closedNodes(extra?: string): Set<string> {
    const closed = new Set<string>(this.closures.keys());
    for (const defense of this.defenses()) if (defense.blocking) closed.add(defense.nodeId);
    if (extra) closed.add(extra);
    return closed;
  }

  /** Nodes groups cannot pass right now, with the roadblock there (null for a closed branch). */
  private blockers(): Map<string, DefenseEntity | null> {
    const map = new Map<string, DefenseEntity | null>();
    for (const defense of this.defenses())
      if (defense.blocking && this.isActive(defense) && !map.has(defense.nodeId))
        map.set(defense.nodeId, defense);
    for (const nodeId of this.closures.keys()) if (!map.has(nodeId)) map.set(nodeId, null);
    return map;
  }

  private blocksWhenActive(defense: DefenseEntity): boolean {
    return (
      this.defenseType(defense).blocksNode && !defense.mobile && this.graph.routeNodes.has(defense.nodeId)
    );
  }

  private upgradeCost(defense: DefenseEntity): number {
    const type = this.defenseType(defense);
    return Math.round(type.cost * type.upgradeCostFactor * defense.level);
  }

  private repairCost(defense: DefenseEntity): number {
    return Math.ceil((this.defenseType(defense).cost * REPAIR_COST_SHARE * (100 - defense.condition)) / 100);
  }

  private reach(defense: DefenseEntity): number {
    return this.defenseType(defense).range * (1 + UPGRADE_RANGE_BONUS * (defense.level - 1));
  }

  private detectionRange(defense: DefenseEntity): number {
    return (
      this.defenseType(defense).detectionRange *
      (1 + UPGRADE_RANGE_BONUS * (defense.level - 1)) *
      (1 + this.status.magnitude(defense.id, 'boost:detectionRange', this.tickCount))
    );
  }

  /** Share of wear and sabotage a defense shrugs off: protection effects and the profile's passive. */
  private defenseProtection(defense: DefenseEntity): number {
    return Math.min(
      0.9,
      this.status.magnitude(defense.id, 'protected', this.tickCount) + this.passive('defender', 'protect'),
    );
  }

  /** Strongest running boost of a stat on a group (the plain boost counts as speed). */
  private groupBoost(group: GroupEntity, stat: BoostStat): number {
    const own = this.status.magnitude(group.id, `boost:${stat}`, this.tickCount);
    return stat === 'speed'
      ? Math.max(own, this.status.magnitude(group.id, 'boost:plain', this.tickCount))
      : own;
  }

  /**
   * Sum of a side's passive effects of a type (and for boosts, of a stat). Conditions are checked against `group`;
   * without one, conditional passives do not count.
   */
  private passive(side: Side, type: EffectType, stat?: BoostStat, group?: GroupEntity): number {
    let total = 0;
    for (const effect of this.setup[side].passive) {
      if (effect.type !== type) continue;
      if (type === 'boost' && (effect.stat ?? 'speed') !== stat) continue;
      if (effect.condition === 'knownRoute' && !(group && this.data(group).knownRoute)) continue;
      if (effect.condition === 'atObjective' && group?.state !== 'atObjective') continue;
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

  /** Working: not worn down to 0 and not sabotaged. */
  private isActive(defense: DefenseEntity): boolean {
    return defense.condition > 0 && !this.status.active(defense.id, 'disrupted', this.tickCount);
  }

  /** Defenses that are not disrupted. */
  private activeDefenses(): DefenseEntity[] {
    return this.defenses().filter((defense) => this.isActive(defense));
  }
}
