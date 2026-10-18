/**
 * Sound effects made in code with Web Audio (spec §18 allows generated sound; CC0 recordings can replace them later).
 * Each cue is a short envelope of one or two tones or a burst of filtered noise, kept soft so it never gets tiring.
 */
export const SOUND_CUES = [
  'click',
  'select',
  'build',
  'launch',
  'ability',
  'abilityReady',
  'spotted',
  'objective',
  'rejected',
  'hint',
  'victory',
  'defeat',
] as const;
export type SoundCue = (typeof SOUND_CUES)[number];

interface Tone {
  /** Start and end frequency in Hz. */
  from: number;
  to?: number;
  at?: number;
  length: number;
  type?: OscillatorType;
  gain?: number;
}

const TONES: Record<SoundCue, Tone[]> = {
  click: [{ from: 880, to: 660, length: 0.05, type: 'triangle', gain: 0.25 }],
  select: [{ from: 660, to: 990, length: 0.08, type: 'triangle', gain: 0.3 }],
  build: [
    { from: 220, to: 180, length: 0.12, type: 'square', gain: 0.18 },
    { from: 440, at: 0.08, length: 0.14, type: 'triangle', gain: 0.25 },
  ],
  launch: [
    { from: 330, to: 520, length: 0.18, type: 'sawtooth', gain: 0.12 },
    { from: 520, to: 660, at: 0.12, length: 0.16, type: 'triangle', gain: 0.22 },
  ],
  ability: [{ from: 520, to: 1040, length: 0.22, type: 'sine', gain: 0.3 }],
  abilityReady: [
    { from: 784, length: 0.08, type: 'sine', gain: 0.22 },
    { from: 1175, at: 0.08, length: 0.12, type: 'sine', gain: 0.22 },
  ],
  spotted: [
    { from: 988, length: 0.07, type: 'square', gain: 0.1 },
    { from: 988, at: 0.12, length: 0.07, type: 'square', gain: 0.1 },
  ],
  objective: [
    { from: 392, length: 0.2, type: 'triangle', gain: 0.25 },
    { from: 370, at: 0.22, length: 0.25, type: 'triangle', gain: 0.25 },
  ],
  rejected: [{ from: 200, to: 150, length: 0.16, type: 'square', gain: 0.12 }],
  hint: [
    { from: 660, length: 0.1, type: 'sine', gain: 0.2 },
    { from: 880, at: 0.1, length: 0.16, type: 'sine', gain: 0.2 },
  ],
  victory: [
    { from: 523, length: 0.16, type: 'triangle', gain: 0.3 },
    { from: 659, at: 0.16, length: 0.16, type: 'triangle', gain: 0.3 },
    { from: 784, at: 0.32, length: 0.16, type: 'triangle', gain: 0.3 },
    { from: 1047, at: 0.48, length: 0.5, type: 'triangle', gain: 0.3 },
  ],
  defeat: [
    { from: 392, length: 0.22, type: 'triangle', gain: 0.28 },
    { from: 349, at: 0.24, length: 0.22, type: 'triangle', gain: 0.28 },
    { from: 294, at: 0.48, length: 0.6, type: 'triangle', gain: 0.28 },
  ],
};

/** Shortest gap between two plays of the same cue, so a burst of events stays one sound. */
const MIN_GAP_SECONDS = 0.08;

export class SoundBoard {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private volume = 0.64;
  private readonly lastPlayed = new Map<SoundCue, number>();

  /** Master × effects volume, 0–1. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.output) this.output.gain.value = this.volume;
  }

  play(cue: SoundCue): void {
    if (this.volume <= 0) return;
    const context = this.ensureContext();
    if (!context || !this.output) return;
    const now = context.currentTime;
    if (now - (this.lastPlayed.get(cue) ?? -1) < MIN_GAP_SECONDS) return;
    this.lastPlayed.set(cue, now);
    for (const tone of TONES[cue]) this.tone(context, this.output, tone, now);
  }

  private tone(context: AudioContext, output: AudioNode, tone: Tone, now: number): void {
    const start = now + (tone.at ?? 0);
    const end = start + tone.length;
    const oscillator = context.createOscillator();
    oscillator.type = tone.type ?? 'sine';
    oscillator.frequency.setValueAtTime(tone.from, start);
    if (tone.to) oscillator.frequency.exponentialRampToValueAtTime(tone.to, end);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(tone.gain ?? 0.25, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(envelope).connect(output);
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  }

  /** Browsers only allow audio after a user gesture; the first play after a click starts the context. */
  private ensureContext(): AudioContext | null {
    if (this.context) {
      if (this.context.state === 'suspended') void this.context.resume();
      return this.context;
    }
    const Context =
      window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return null;
    try {
      this.context = new Context();
    } catch {
      return null;
    }
    this.output = this.context.createGain();
    this.output.gain.value = this.volume;
    this.output.connect(this.context.destination);
    return this.context;
  }
}

/** One sound board for the whole page. */
export const sounds = new SoundBoard();
