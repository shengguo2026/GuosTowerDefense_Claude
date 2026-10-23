import type { Translate } from '@gtd/i18n';
import { levelProgress } from '@gtd/progression';

/** A profile's level and the XP towards the next one (the level is derived from the stored XP). */
export function LevelBar({ xp, t, compact = false }: { xp: number; t: Translate; compact?: boolean }) {
  const { level, into, span } = levelProgress(xp);
  const share = span === null ? 1 : into / span;
  const label =
    span === null ? t('progress.levelMax', { level, xp }) : t('progress.levelOf', { level, into, span });
  return (
    <div className={`level-bar${compact ? ' compact' : ''}`} data-testid="level-bar">
      <span className="level-bar-label">{label}</span>
      <span
        className="level-bar-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <span className="level-bar-fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}
