import type { Side } from './types';

interface CommandBase {
  /** The tick the command should apply on. Late commands apply on the next tick that runs. */
  tick: number;
  side: Side;
}

export interface LaunchGroupCommand extends CommandBase {
  type: 'launchGroup';
  side: 'attacker';
  unitTypeId: string;
  count: number;
  routeId: string;
}

export interface PlaceDefenseCommand extends CommandBase {
  type: 'placeDefense';
  side: 'defender';
  defenseTypeId: string;
  nodeId: string;
}

export type Command = LaunchGroupCommand | PlaceDefenseCommand;

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
