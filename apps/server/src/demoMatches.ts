import { createMatchSetup, type StagePack } from '@gtd/content-schema';
import type { ServerMessage } from '@gtd/protocol';
import { scriptedAttacker, scriptedDefender } from '@gtd/test-kit';
import { MatchHost } from './matchHost';

type Send = (message: ServerMessage) => void;

interface Demo {
  host: MatchHost;
  matchId: string;
  started: ServerMessage;
  watchers: Set<Send>;
  restartTimer?: NodeJS.Timeout;
}

/** Pause between the end of a demo match and the next one, so the result stays visible for a moment. */
const RESTART_DELAY_MS = 4000;

/**
 * Level previews: the server plays the level by itself with scripted controllers and streams it to every watcher.
 * One demo runs per level while anyone watches; it stops when the last watcher leaves.
 */
export class DemoMatches {
  private readonly demos = new Map<string, Demo>();
  private matchCounter = 0;

  constructor(private readonly stages: StagePack[]) {}

  /** Returns false when the stage or level does not exist. */
  watch(stageId: string, levelId: string, send: Send): boolean {
    const pack = this.stages.find((stage) => stage.manifest.id === stageId);
    if (!pack?.levels.some((level) => level.id === levelId)) return false;
    const key = `${stageId}/${levelId}`;
    let demo = this.demos.get(key);
    if (!demo) {
      demo = this.start(pack, levelId, new Set());
      this.demos.set(key, demo);
    }
    demo.watchers.add(send);
    send(demo.started);
    send({ type: 'snapshot', matchId: demo.matchId, snapshot: demo.host.match.snapshot() });
    return true;
  }

  unwatch(send: Send): void {
    for (const [key, demo] of this.demos) {
      demo.watchers.delete(send);
      if (demo.watchers.size === 0) {
        demo.host.stop();
        clearTimeout(demo.restartTimer);
        this.demos.delete(key);
      }
    }
  }

  stopAll(): void {
    for (const demo of this.demos.values()) {
      demo.host.stop();
      clearTimeout(demo.restartTimer);
    }
    this.demos.clear();
  }

  get running(): number {
    return this.demos.size;
  }

  private start(pack: StagePack, levelId: string, watchers: Set<Send>): Demo {
    const matchId = `demo-${++this.matchCounter}`;
    const attackerProfileId = pack.manifest.profiles.attacker[0] as string;
    const defenderProfileId = pack.manifest.profiles.defender[0] as string;
    const setup = createMatchSetup(pack, {
      levelId,
      attackerProfileId,
      defenderProfileId,
      seed: this.matchCounter,
    });
    const started: ServerMessage = {
      type: 'matchStarted',
      matchId,
      stageId: pack.manifest.id,
      levelId,
      attackerProfileId,
      defenderProfileId,
    };
    const broadcast = (message: ServerMessage) => watchers.forEach((send) => send(message));
    const demo: Demo = {
      matchId,
      started,
      watchers,
      host: new MatchHost({
        setup,
        attacker: scriptedAttacker(3, 100, { mixUnits: true }),
        defender: scriptedDefender({ maxDefenses: 2, startTick: 400 }),
        onSnapshot: (snapshot) => broadcast({ type: 'snapshot', matchId, snapshot }),
        onEnd: () => {
          demo.restartTimer = setTimeout(() => {
            const key = `${pack.manifest.id}/${levelId}`;
            if (this.demos.get(key) !== demo) return;
            const next = this.start(pack, levelId, watchers);
            this.demos.set(key, next);
            broadcast(next.started);
          }, RESTART_DELAY_MS);
        },
      }),
    };
    demo.host.start();
    return demo;
  }
}
