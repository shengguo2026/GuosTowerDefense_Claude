export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Difficulty changes how well the AI thinks, not the rules it plays by: how often it looks at the match, how much of
 * what it sees it takes into account, how efficiently it spends, and how hard it punishes mistakes.
 */
export interface AttackerTuning {
  /** Ticks between two looks at the match (reaction time). */
  thinkEveryTicks: number;
  /** Weighs routes by the defenses it has seen; otherwise picks routes at random. */
  readsDefenses: boolean;
  /** Share of the members it estimates a wave needs that it waits to have before launching (0 = launch at once). */
  patience: number;
  /**
   * Largest share of the remaining capacity one wave may use. A defense presses one group at a time, so one big wave
   * loses fewer members on the way than the same members sent in several waves.
   */
  maxWaveShare: number;
  /** Members per wave when it does not estimate (Easy). */
  plainWaveSize: [number, number];
  /** Uses spread formation where it expects pressure. */
  formations: boolean;
  /** Holds at junctions and reroutes away from roadblocks and heavy defenses. */
  reroutes: boolean;
  /** Abilities it may use. */
  recon: boolean;
  rapidReroute: boolean;
  /** Extra members on top of the estimate, for what it cannot see coming (boosts, slows, new defenses). */
  margin: number;
  /** Chance per decision to make a plainly worse choice. */
  mistakeChance: number;
}

export interface DefenderTuning {
  thinkEveryTicks: number;
  /** Places assets where they cover the most route; otherwise picks legal spots at random. */
  readsMap: boolean;
  /** Supplies it keeps back before building (buys only when it has this much more than the price). */
  reserve: number;
  upgrades: boolean;
  repairs: boolean;
  /** Keeps a patrol on the objective to contest it. */
  contestsObjective: boolean;
  /** Sends patrols toward groups it detects. */
  intercepts: boolean;
  /** Abilities it may use. */
  rapidResponse: boolean;
  intercept: boolean;
  mistakeChance: number;
}

export const ATTACKER_TUNING: Record<Difficulty, AttackerTuning> = {
  easy: {
    thinkEveryTicks: 40,
    readsDefenses: false,
    patience: 0,
    maxWaveShare: 0.25,
    plainWaveSize: [3, 6],
    formations: false,
    reroutes: false,
    recon: false,
    rapidReroute: false,
    margin: 1,
    mistakeChance: 0.3,
  },
  medium: {
    thinkEveryTicks: 20,
    readsDefenses: true,
    patience: 0.6,
    maxWaveShare: 0.4,
    plainWaveSize: [5, 8],
    formations: true,
    reroutes: false,
    recon: true,
    rapidReroute: false,
    margin: 1.1,
    mistakeChance: 0.12,
  },
  hard: {
    thinkEveryTicks: 8,
    readsDefenses: true,
    patience: 1,
    maxWaveShare: 1,
    plainWaveSize: [8, 12],
    formations: true,
    reroutes: true,
    recon: true,
    rapidReroute: true,
    margin: 1.25,
    mistakeChance: 0,
  },
};

export const DEFENDER_TUNING: Record<Difficulty, DefenderTuning> = {
  easy: {
    thinkEveryTicks: 40,
    readsMap: false,
    reserve: 30,
    upgrades: false,
    repairs: false,
    contestsObjective: false,
    intercepts: false,
    rapidResponse: false,
    intercept: false,
    mistakeChance: 0.3,
  },
  medium: {
    thinkEveryTicks: 20,
    readsMap: true,
    reserve: 10,
    upgrades: false,
    repairs: true,
    contestsObjective: true,
    intercepts: false,
    rapidResponse: false,
    intercept: true,
    mistakeChance: 0.12,
  },
  hard: {
    thinkEveryTicks: 8,
    readsMap: true,
    reserve: 0,
    upgrades: true,
    repairs: true,
    contestsObjective: true,
    intercepts: true,
    rapidResponse: true,
    intercept: true,
    mistakeChance: 0,
  },
};
