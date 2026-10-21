import type { DefenseOrder, Formation, Side, TargetPriority } from './types';

interface CommandBase {
  /** The tick the command should apply on. Late commands apply on the next tick that runs. */
  tick: number;
  side: Side;
}

/** One group of a wave, as set up in the wave builder. */
export interface WaveGroupOrder {
  unitTypeId: string;
  count: number;
  formation: Formation;
  routeId: string;
  /** Seconds after the wave's launch before this group sets off. */
  delaySeconds: number;
}

export interface LaunchWaveCommand extends CommandBase {
  type: 'launchWave';
  side: 'attacker';
  groups: WaveGroupOrder[];
}

/** Stop at the next junction, or at a chosen junction further ahead (or stay, when already holding). */
export interface HoldGroupCommand extends CommandBase {
  type: 'holdGroup';
  side: 'attacker';
  groupId: number;
  nodeId?: string;
}

/** Resume a holding group, or cancel a pending hold. */
export interface AdvanceGroupCommand extends CommandBase {
  type: 'advanceGroup';
  side: 'attacker';
  groupId: number;
}

/**
 * Change route while holding at a junction that lies on the new route; or, with `nodeId`, switch to it on arriving at
 * that node ahead (both routes must pass it).
 */
export interface RerouteGroupCommand extends CommandBase {
  type: 'rerouteGroup';
  side: 'attacker';
  groupId: number;
  routeId: string;
  nodeId?: string;
}

/** Walk back to the spawn point; part of the capacity and supplies is refunded when the group leaves. */
export interface RetreatGroupCommand extends CommandBase {
  type: 'retreatGroup';
  side: 'attacker';
  groupId: number;
}

export interface SetFormationCommand extends CommandBase {
  type: 'setFormation';
  side: 'attacker';
  groupId: number;
  formation: Formation;
}

export interface PlaceDefenseCommand extends CommandBase {
  type: 'placeDefense';
  side: 'defender';
  defenseTypeId: string;
  nodeId: string;
}

export interface UpgradeDefenseCommand extends CommandBase {
  type: 'upgradeDefense';
  side: 'defender';
  defenseId: number;
}

export interface RepairDefenseCommand extends CommandBase {
  type: 'repairDefense';
  side: 'defender';
  defenseId: number;
}

export interface SellDefenseCommand extends CommandBase {
  type: 'sellDefense';
  side: 'defender';
  defenseId: number;
}

/** Guard a node, or patrol back and forth between two nodes (mobile assets only). */
export interface OrderDefenseCommand extends CommandBase {
  type: 'orderDefense';
  side: 'defender';
  defenseId: number;
  order: DefenseOrder;
}

export interface SetPriorityCommand extends CommandBase {
  type: 'setPriority';
  side: 'defender';
  defenseId: number;
  priority: TargetPriority;
}

/** Focus a detected group in range; `null` clears the focus. */
export interface FocusTargetCommand extends CommandBase {
  type: 'focusTarget';
  side: 'defender';
  defenseId: number;
  groupId: number | null;
}

/**
 * Focus Defense: the group stops near a defense it can see and takes it apart (units with a dismantle rate only).
 * Without `defenseId` it picks the nearest one in sight; `null` stops working.
 */
export interface FocusDefenseCommand extends CommandBase {
  type: 'focusDefense';
  side: 'attacker';
  groupId: number;
  defenseId?: number | null;
}

/**
 * Use one of the profile's command slots that is made of effects (order slots send their own command). It is aimed
 * from the selected group (Attacker) or asset (Defender).
 */
export interface UseCommandCommand extends CommandBase {
  type: 'useCommand';
  commandId: string;
  groupId?: number;
  defenseId?: number;
}

/** Use one of the side's abilities. Which fields are needed depends on the ability's target type. */
export interface UseAbilityCommand extends CommandBase {
  type: 'useAbility';
  abilityId: string;
  x?: number;
  z?: number;
  groupId?: number;
  routeId?: string;
  /** For junction abilities: the node (otherwise the route node nearest to `x`/`z`). */
  nodeId?: string;
}

export type Command =
  | LaunchWaveCommand
  | HoldGroupCommand
  | AdvanceGroupCommand
  | RerouteGroupCommand
  | RetreatGroupCommand
  | SetFormationCommand
  | PlaceDefenseCommand
  | UpgradeDefenseCommand
  | RepairDefenseCommand
  | SellDefenseCommand
  | OrderDefenseCommand
  | SetPriorityCommand
  | FocusTargetCommand
  | FocusDefenseCommand
  | UseCommandCommand
  | UseAbilityCommand;

export type CommandType = Command['type'];

/** Which side may send each command (abilities and command slots are checked against their owner). */
export const COMMAND_SIDES: Record<Exclude<CommandType, 'useAbility' | 'useCommand'>, Side> = {
  launchWave: 'attacker',
  holdGroup: 'attacker',
  advanceGroup: 'attacker',
  rerouteGroup: 'attacker',
  retreatGroup: 'attacker',
  setFormation: 'attacker',
  focusDefense: 'attacker',
  placeDefense: 'defender',
  upgradeDefense: 'defender',
  repairDefense: 'defender',
  sellDefense: 'defender',
  orderDefense: 'defender',
  setPriority: 'defender',
  focusTarget: 'defender',
};

interface QueuedCommand {
  command: Command;
  seq: number;
}

const SIDE_ORDER: Record<Side, number> = { attacker: 0, defender: 1 };

/**
 * Collects commands from players and AI and hands them to the simulation in a fixed order:
 * by tick, then side, then arrival order.
 */
export class CommandQueue {
  private pending: QueuedCommand[] = [];
  private seq = 0;

  enqueue(command: Command): void {
    this.pending.push({ command, seq: this.seq++ });
  }

  /** Removes and returns every command due on or before `tick`, in deterministic order. */
  drain(tick: number): Command[] {
    const due: QueuedCommand[] = [];
    const later: QueuedCommand[] = [];
    for (const entry of this.pending) (entry.command.tick <= tick ? due : later).push(entry);
    this.pending = later;
    due.sort(
      (a, b) =>
        a.command.tick - b.command.tick ||
        SIDE_ORDER[a.command.side] - SIDE_ORDER[b.command.side] ||
        a.seq - b.seq,
    );
    return due.map((entry) => entry.command);
  }

  get size(): number {
    return this.pending.length;
  }
}
