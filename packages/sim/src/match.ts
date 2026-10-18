import {
  CommandQueue,
  type Command,
  type LaunchGroupCommand,
  type PlaceDefenseCommand,
} from './commandQueue';
import { TICK_SECONDS, secondsToTicks } from './constants';
import { EntityStore } from './entityStore';
import { EventLog } from './eventLog';
import { Rng } from './rng';
import type {
  DefenseEntity,
  GroupEntity,
  MapNode,
  MatchEntity,
  MatchResult,
  MatchSetup,
  MatchSnapshot,
  Route,
  Side,
  SimDefenseType,
  SimUnitType,
} from './types';

/**
 * One match of the simulation. Call `enqueue` with commands and `step` once per tick; the match never reads the clock
 * and draws randomness only from its seed, so it runs the same on the server, in headless tests and in replays.
 */
export class Match {
  readonly events = new EventLog();
  private readonly commands = new CommandQueue();
  private readonly entities = new EntityStore<MatchEntity>();
  private readonly rng: Rng;
  private readonly nodes: Map<string, MapNode>;
  private readonly routes: Map<string, Route>;
  private readonly unitTypes: Map<string, SimUnitType>;
  private readonly defenseTypes: Map<string, SimDefenseType>;
  private readonly timerTicks: number;
  private readonly holdTicksRequired: number;
  private readonly resources: Record<Side, number>;
  private tickCount = 0;
  private heldTicks = 0;
  private outcome: MatchResult | null = null;

  constructor(private readonly setup: MatchSetup) {
    const { level } = setup;
    this.rng = new Rng(setup.seed);
    this.nodes = new Map(level.nodes.map((node) => [node.id, node]));
    this.routes = new Map(level.routes.map((route) => [route.id, route]));
    this.unitTypes = new Map(setup.attacker.units.map((unit) => [unit.id, unit]));
    this.defenseTypes = new Map(setup.defender.defenses.map((defense) => [defense.id, defense]));
    this.timerTicks = secondsToTicks(level.timerSeconds);
    this.holdTicksRequired = secondsToTicks(level.objective.holdSeconds);
    this.resources = { ...level.startingResources };
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

  enqueue(command: Command): void {
    this.commands.enqueue(command);
  }

  /** Advances the match by one tick. Does nothing once the match has ended. */
  step(): void {
    if (this.outcome) return;
    this.tickCount++;
    for (const command of this.commands.drain(this.tickCount)) this.apply(command);
    this.addIncome();
    this.moveGroups();
    this.applyDefensePressure();
    this.updateObjective();
    if (!this.outcome && this.tickCount >= this.timerTicks)
      this.end({ winner: 'defender', reason: 'timerExpired' });
  }

  snapshot(): MatchSnapshot {
    return {
      tick: this.tickCount,
      phase: this.outcome ? 'ended' : 'running',
      result: this.outcome,
      resources: { ...this.resources },
      objective: {
        nodeId: this.setup.level.objective.nodeId,
        heldTicks: this.heldTicks,
        requiredTicks: this.holdTicksRequired,
      },
      remainingTicks: Math.max(0, this.timerTicks - this.tickCount),
      entities: this.entities.all().map((entity) => ({ ...entity })),
    };
  }

  private apply(command: Command): void {
    const reason = command.type === 'launchGroup' ? this.launchGroup(command) : this.placeDefense(command);
    if (reason) {
      this.events.push({
        tick: this.tickCount,
        type: 'commandRejected',
        side: command.side,
        command: command.type,
        reason,
      });
    }
  }

  /** Returns a rejection reason, or null when the group was launched. */
  private launchGroup(command: LaunchGroupCommand): string | null {
    const unit = this.unitTypes.get(command.unitTypeId);
    const route = this.routes.get(command.routeId);
    if (!unit) return 'unknownUnit';
    if (!route) return 'unknownRoute';
    if (!Number.isInteger(command.count) || command.count < 1) return 'invalidCount';
    const cost = unit.cost * command.count;
    if (cost > this.resources.attacker) return 'notEnoughResources';
    this.resources.attacker -= cost;
    const start = this.node(route.nodes[0]);
    const group = this.entities.create((id): GroupEntity => ({
      id,
      kind: 'group',
      unitTypeId: unit.id,
      count: command.count,
      routeId: route.id,
      segment: 0,
      distance: 0,
      // Small seeded variation so groups launched together spread out a little.
      speed: unit.speed * this.rng.range(0.95, 1.05),
      pressure: 0,
      state: 'moving',
      x: start.x,
      z: start.z,
    }));
    this.events.push({
      tick: this.tickCount,
      type: 'groupLaunched',
      groupId: group.id,
      unitTypeId: unit.id,
      count: group.count,
      routeId: route.id,
    });
    return null;
  }

  private placeDefense(command: PlaceDefenseCommand): string | null {
    const type = this.defenseTypes.get(command.defenseTypeId);
    const node = this.nodes.get(command.nodeId);
    if (!type) return 'unknownDefense';
    if (!node) return 'unknownNode';
    if (!node.buildable) return 'notBuildable';
    if (this.defenses().some((defense) => defense.nodeId === node.id)) return 'occupied';
    if (type.cost > this.resources.defender) return 'notEnoughResources';
    this.resources.defender -= type.cost;
    const defense = this.entities.create((id): DefenseEntity => ({
      id,
      kind: 'defense',
      defenseTypeId: type.id,
      nodeId: node.id,
      x: node.x,
      z: node.z,
    }));
    this.events.push({
      tick: this.tickCount,
      type: 'defensePlaced',
      defenseId: defense.id,
      defenseTypeId: type.id,
      nodeId: node.id,
    });
    return null;
  }

  private addIncome(): void {
    const { incomePerSecond } = this.setup.level;
    this.resources.attacker += incomePerSecond.attacker * TICK_SECONDS;
    this.resources.defender += incomePerSecond.defender * TICK_SECONDS;
  }

  private moveGroups(): void {
    for (const group of this.groups()) {
      if (group.state !== 'moving') continue;
      const route = this.routes.get(group.routeId) as Route;
      let remaining = group.speed * TICK_SECONDS;
      while (remaining > 0 && group.segment < route.nodes.length - 1) {
        const from = this.node(route.nodes[group.segment]);
        const to = this.node(route.nodes[group.segment + 1]);
        const length = Math.hypot(to.x - from.x, to.z - from.z);
        const left = length - group.distance;
        if (remaining < left) {
          group.distance += remaining;
          remaining = 0;
        } else {
          remaining -= left;
          group.segment++;
          group.distance = 0;
        }
        const nextFrom = this.node(route.nodes[group.segment]);
        const nextTo = this.node(route.nodes[Math.min(group.segment + 1, route.nodes.length - 1)]);
        const segmentLength = Math.hypot(nextTo.x - nextFrom.x, nextTo.z - nextFrom.z);
        const t = segmentLength > 0 ? group.distance / segmentLength : 0;
        group.x = nextFrom.x + (nextTo.x - nextFrom.x) * t;
        group.z = nextFrom.z + (nextTo.z - nextFrom.z) * t;
      }
      if (group.segment >= route.nodes.length - 1) {
        group.state = 'holding';
        this.events.push({ tick: this.tickCount, type: 'groupReachedObjective', groupId: group.id });
      }
    }
  }

  /** Non-lethal: a group under enough pressure is turned back and walks off the map. */
  private applyDefensePressure(): void {
    const defenses = this.defenses();
    for (const group of this.groups()) {
      const unit = this.unitTypes.get(group.unitTypeId) as SimUnitType;
      for (const defense of defenses) {
        const type = this.defenseTypes.get(defense.defenseTypeId) as SimDefenseType;
        if (Math.hypot(group.x - defense.x, group.z - defense.z) > type.range) continue;
        group.pressure += type.pressurePerSecond * TICK_SECONDS;
        if (group.pressure >= unit.resilience * group.count) {
          this.entities.remove(group.id);
          this.events.push({
            tick: this.tickCount,
            type: 'groupStopped',
            groupId: group.id,
            byDefenseId: defense.id,
          });
          break;
        }
      }
    }
  }

  private updateObjective(): void {
    if (this.groups().some((group) => group.state === 'holding')) this.heldTicks++;
    if (this.heldTicks >= this.holdTicksRequired) this.end({ winner: 'attacker', reason: 'objectiveHeld' });
  }

  private end(result: MatchResult): void {
    this.outcome = result;
    this.events.push({ tick: this.tickCount, type: 'matchEnded', result });
  }

  private groups(): GroupEntity[] {
    return this.entities.filter((entity): entity is GroupEntity => entity.kind === 'group');
  }

  private defenses(): DefenseEntity[] {
    return this.entities.filter((entity): entity is DefenseEntity => entity.kind === 'defense');
  }

  private node(id: string | undefined): MapNode {
    const node = id === undefined ? undefined : this.nodes.get(id);
    if (!node) throw new Error(`Unknown map node "${id}"`);
    return node;
  }
}
