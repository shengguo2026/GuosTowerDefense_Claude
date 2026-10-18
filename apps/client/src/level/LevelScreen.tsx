import type { StagePack } from '@gtd/content-schema';
import { createTranslator, type Language, type Translate } from '@gtd/i18n';
import type { GraphicsPreset } from '@gtd/protocol';
import { TICK_MS, type MatchSnapshot } from '@gtd/sim';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import type { ServerConnection } from '../useServerConnection';
import { LevelView, type RenderStats } from '../world/levelView';
import { currentDevice, resolvePreset } from '../world/presets';

interface Props {
  stageId: string;
  levelId: string;
  language: Language;
  graphics: GraphicsPreset;
  connection: ServerConnection;
  t: Translate;
  onBack(): void;
  onSettings(): void;
}

function formatTime(ticks: number): string {
  const seconds = Math.max(0, Math.ceil((ticks * TICK_MS) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A level on screen with the server's demo match running on it (the level preview of M1). */
export function LevelScreen({
  stageId,
  levelId,
  language,
  graphics,
  connection,
  t,
  onBack,
  onSettings,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<LevelView | null>(null);
  const [pack, setPack] = useState<StagePack | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [showStats, setShowStats] = useState(() => new URLSearchParams(location.search).has('debug'));
  const [stats, setStats] = useState<RenderStats | null>(null);
  const preset = useMemo(() => resolvePreset(graphics, currentDevice()), [graphics]);
  const stageText = useMemo(() => (pack ? createTranslator(language, pack.texts) : null), [pack, language]);
  const level = pack?.levels.find((l) => l.id === levelId) ?? null;

  useEffect(() => {
    let cancelled = false;
    api.stage(stageId).then(
      (loaded) => !cancelled && setPack(loaded),
      (error: Error) => !cancelled && setLoadError(error.message),
    );
    return () => {
      cancelled = true;
    };
  }, [stageId]);

  // The view is rebuilt when the preset or language changes; both are rare and need new geometry or labels.
  useEffect(() => {
    const canvas = canvasRef.current;
    const labelLayer = labelsRef.current;
    if (!canvas || !labelLayer || !pack || !level || !stageText) return;
    const view = new LevelView({
      canvas,
      labelLayer,
      pack,
      level,
      preset,
      stageText,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.dispose();
    };
  }, [pack, level, preset, stageText]);

  const { subscribe, send, status } = connection;
  useEffect(() => {
    let lastHud = 0;
    return subscribe((message) => {
      if (message.type === 'matchStarted') viewRef.current?.buffer.clear();
      if (message.type !== 'snapshot') return;
      viewRef.current?.pushSnapshot(message.snapshot);
      // The HUD only needs a few updates a second.
      const now = performance.now();
      if (now - lastHud > 250 || message.snapshot.phase === 'ended') {
        lastHud = now;
        setSnapshot(message.snapshot);
      }
    });
  }, [subscribe]);

  useEffect(() => {
    if (status !== 'connected') return;
    send({ type: 'watchDemo', stageId, levelId });
    return () => {
      send({ type: 'stopWatching' });
    };
  }, [send, status, stageId, levelId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault();
        setShowStats((shown) => !shown);
      } else if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) {
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  useEffect(() => {
    if (!showStats) return;
    const timer = window.setInterval(() => setStats(viewRef.current?.renderStats ?? null), 500);
    return () => window.clearInterval(timer);
  }, [showStats]);

  const groups = snapshot?.entities.filter((e) => e.kind === 'group').length ?? 0;
  const held = snapshot ? snapshot.objective.heldTicks / snapshot.objective.requiredTicks : 0;

  return (
    <div className="level-screen" data-testid="level-screen">
      <canvas ref={canvasRef} className="world-canvas" data-testid="level-canvas" />
      <div ref={labelsRef} className="label-layer" aria-hidden="true" />

      <div className="level-hud top">
        <button type="button" className="hud-button" onClick={onBack} data-testid="level-back">
          <span aria-hidden="true">‹</span> {t('level.back')}
        </button>
        <div className="level-title panel">
          <strong>{level && stageText ? stageText(level.title) : t('level.loading')}</strong>
          <span className="badge">{t('level.demo')}</span>
        </div>
        <div className="hud-group">
          <button
            type="button"
            className="hud-button"
            onClick={() => viewRef.current?.resetCamera()}
            aria-label={t('level.resetCamera')}
            title={t('level.resetCamera')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path fill="currentColor" d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z" />
            </svg>
          </button>
          <button
            type="button"
            className="hud-button"
            onClick={onSettings}
            aria-label={t('settings.title')}
            title={t('settings.title')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                fill="currentColor"
                d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1l.4 2.7h4l.4-2.7c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"
                transform="translate(-1 0)"
              />
            </svg>
          </button>
        </div>
      </div>

      {snapshot && (
        <div className="level-hud bottom panel" data-testid="match-status">
          <span>
            {t('level.timeLeft')} <strong>{formatTime(snapshot.remainingTicks)}</strong>
          </span>
          <span>{t('level.groups', { count: groups })}</span>
          <span className="hold">
            {t('level.objective')}
            <span
              className="hold-bar"
              role="progressbar"
              aria-valuenow={Math.round(held * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${Math.round(held * 100)}%` }} />
            </span>
          </span>
          {snapshot.result && (
            <strong className={`result ${snapshot.result.winner}`}>
              {t(`level.winner.${snapshot.result.winner}`)}
            </strong>
          )}
        </div>
      )}

      {showStats && stats && (
        <pre className="perf-overlay" data-testid="perf-overlay">
          {`${stats.fps} fps  ${stats.frameMs} ms
${t('perf.preset')}: ${stats.preset} @${stats.pixelRatio}x
${t('perf.drawCalls')}: ${stats.drawCalls}
${t('perf.triangles')}: ${stats.triangles.toLocaleString()}
${t('perf.geometries')}: ${stats.geometries}  ${t('perf.textures')}: ${stats.textures}`}
        </pre>
      )}

      <p className="camera-hint">{t('level.cameraHint')}</p>

      {loadError && <p className="error panel level-error">{loadError}</p>}
    </div>
  );
}
