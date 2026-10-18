import type { GraphicsPreset } from '@gtd/protocol';

export type ResolvedPreset = Exclude<GraphicsPreset, 'auto'>;

export interface PresetSettings {
  name: ResolvedPreset;
  pixelRatio: number;
  antialias: boolean;
  /** 0 turns real shadows off; contact shadows are always drawn. */
  shadowMapSize: number;
  terrainSegments: number;
  grassTufts: number;
  treeDensity: number;
  pebbles: number;
}

/** Presets change density and resolution only; nothing that matters for play is ever hidden (spec §19). */
export const PRESETS: Record<ResolvedPreset, PresetSettings> = {
  low: {
    name: 'low',
    pixelRatio: 1,
    antialias: false,
    shadowMapSize: 0,
    terrainSegments: 90,
    grassTufts: 2500,
    treeDensity: 0.6,
    pebbles: 300,
  },
  medium: {
    name: 'medium',
    pixelRatio: 1.5,
    antialias: true,
    shadowMapSize: 1024,
    terrainSegments: 110,
    grassTufts: 6000,
    treeDensity: 0.85,
    pebbles: 600,
  },
  high: {
    name: 'high',
    pixelRatio: 2,
    antialias: true,
    shadowMapSize: 2048,
    terrainSegments: 130,
    grassTufts: 10000,
    treeDensity: 1,
    pebbles: 900,
  },
  ultra: {
    name: 'ultra',
    pixelRatio: 2,
    antialias: true,
    shadowMapSize: 2048,
    terrainSegments: 160,
    grassTufts: 16000,
    treeDensity: 1.2,
    pebbles: 1400,
  },
};

export interface DeviceInfo {
  coarsePointer: boolean;
  shortSide: number;
}

/** `auto`: phones get Low, tablets Medium, everything else High. */
export function resolvePreset(preset: GraphicsPreset, device: DeviceInfo): PresetSettings {
  if (preset !== 'auto') return PRESETS[preset];
  if (device.coarsePointer && device.shortSide < 500) return PRESETS.low;
  if (device.coarsePointer) return PRESETS.medium;
  return PRESETS.high;
}

export function currentDevice(): DeviceInfo {
  return {
    coarsePointer: window.matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(window.screen.width, window.screen.height),
  };
}
