import type { Translate } from '@gtd/i18n';
import type { ComputerPlayer, MatchSpeed } from '@gtd/protocol';
import type { MatchSnapshot, Side } from '@gtd/sim';
import { formatSeconds } from '../level/MatchControls';
import { KeyHint } from './KeyHint';
import { Tooltip } from './Tooltip';

interface Props {
  title: string;
  side: Side;
  snapshot: MatchSnapshot | null;
  computer: ComputerPlayer | null;
  paused: boolean;
  speed: MatchSpeed;
  canControlClock: boolean;
  compact: boolean;
  names?: ResourceNames;
  t: Translate;
  onMenu(): void;
  onPause(): void;
  onSpeed(): void;
}

/** Top of the match screen: menu, time, objective, the player's own numbers and the clock buttons. */
export function TopBar({
  title,
  side,
  snapshot,
  computer,
  paused,
  speed,
  canControlClock,
  compact,
  names,
  t,
  onMenu,
  onPause,
  onSpeed,
}: Props) {
  return (
    <header className={`hud-top ${side}`} data-testid="hud-top">
      <button
        type="button"
        className="hud-button"
        onClick={onMenu}
        aria-label={t('pause.title')}
        data-testid="open-menu"
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path fill="currentColor" d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z" />
        </svg>
        <KeyHint action="match.menu" />
      </button>
      {!compact && (
        <div className="hud-title">
          <strong>{title}</strong>
          <span className={`badge ${side}`}>{t(`seat.${side}`)}</span>
          {computer && (
            <span className="badge computer" data-testid="computer-badge">
              {t('hud.vsComputer', { difficulty: t(`difficulty.${computer.difficulty}`) })}
            </span>
          )}
        </div>
      )}
      {snapshot && <MatchClock snapshot={snapshot} t={t} />}
      {snapshot && <ObjectiveBar snapshot={snapshot} side={side} t={t} />}
      {snapshot && <SideNumbers snapshot={snapshot} side={side} t={t} names={names} />}
      {canControlClock && (
        <div className="hud-group clock-buttons">
          <Tooltip text={t('hud.tip.speed')}>
            <button
              type="button"
              className={`hud-button ${speed === 2 ? 'active' : ''}`}
              onClick={onSpeed}
              aria-pressed={speed === 2}
              aria-label={t('hud.speed', { speed })}
              data-testid="speed"
            >
              {speed}×
              <KeyHint action="match.speed" />
            </button>
          </Tooltip>
          <Tooltip text={t('hud.tip.pause')}>
            <button
              type="button"
              className={`hud-button ${paused ? 'active' : ''}`}
              onClick={onPause}
              aria-pressed={paused}
              aria-label={paused ? t('hud.resume') : t('hud.pause')}
              data-testid="pause"
            >
              {paused ? (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="currentColor" d="M7 5v14l12-7z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path fill="currentColor" d="M6 5h4v14H6zm8 0h4v14h-4z" />
                </svg>
              )}
              <KeyHint action="match.pause" />
            </button>
          </Tooltip>
        </div>
      )}
    </header>
  );
}

/** Time left, or the preparation time while the Defender builds. */
export function MatchClock({ snapshot, t }: { snapshot: MatchSnapshot; t: Translate }) {
  return (
    <div className="hud-clock" data-tutorial="timer">
      <Tooltip text={snapshot.phase === 'preparation' ? t('hud.tip.prep') : t('hud.tip.timer')}>
        <span className="clock-text" data-testid="phase">
          {snapshot.phase === 'preparation'
            ? t('hud.prepLeft', { time: formatSeconds(snapshot.preparationRemainingTicks) })
            : formatSeconds(snapshot.remainingTicks)}
        </span>
      </Tooltip>
    </div>
  );
}

/** How long the objective has been held, from the point of view of one side (or neutral in hot-seat). */
export function ObjectiveBar({
  snapshot,
  side,
  t,
}: {
  snapshot: MatchSnapshot;
  side: Side | null;
  t: Translate;
}) {
  const held = snapshot.objective.heldTicks / snapshot.objective.requiredTicks;
  return (
    <Tooltip
      text={t(
        side === 'attacker'
          ? 'hud.tip.objectiveAttacker'
          : side === 'defender'
            ? 'hud.tip.objectiveDefender'
            : 'hot.tip.objective',
      )}
    >
      <div className="hud-objective" data-tutorial="objective" data-testid="objective">
        <span className="label">{t('level.objective')}</span>
        <span
          className="hold-bar"
          role="progressbar"
          aria-label={t('level.objective')}
          aria-valuenow={Math.round(held * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${Math.round(held * 100)}%` }} />
        </span>
        {snapshot.objective.contested && <em className="contested">{t('hud.contested')}</em>}
      </div>
    </Tooltip>
  );
}

/** What the profile calls its two resources (Expedition Supplies, Recon Points …). */
export interface ResourceNames {
  supplies?: string;
  points?: string;
}

/** One side's supplies, points and (Attacker) deployment capacity. */
export function SideNumbers({
  snapshot,
  side,
  t,
  names,
}: {
  snapshot: MatchSnapshot;
  side: Side;
  t: Translate;
  names?: ResourceNames;
}) {
  return (
    <div className={`hud-numbers ${side}`}>
      <Tooltip text={t('hud.tip.supplies')}>
        <span className="number">
          <span className="label">{names?.supplies ?? t('hud.supplies')}</span>
          <strong data-testid={`${side}-supplies`}>{Math.floor(snapshot.resources[side] ?? 0)}</strong>
        </span>
      </Tooltip>
      <Tooltip text={t('hud.tip.points')}>
        <span className="number">
          <span className="label">{names?.points ?? t('hud.points')}</span>
          <strong data-testid={`${side}-points`}>{Math.floor(snapshot.points[side] ?? 0)}</strong>
        </span>
      </Tooltip>
      {side === 'attacker' && (
        <Tooltip text={t('hud.tip.capacity')}>
          <span className="number">
            <span className="label">{t('hud.capacity')}</span>
            <strong data-testid="capacity">
              {snapshot.capacity.remaining}/{snapshot.capacity.total}
            </strong>
          </span>
        </Tooltip>
      )}
    </div>
  );
}
