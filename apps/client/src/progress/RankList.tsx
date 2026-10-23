import type { Profile } from '@gtd/content-schema';
import type { Translate } from '@gtd/i18n';
import { levelForXp } from '@gtd/progression';

/**
 * A profile's XP unlocks (G11): level 1 is the starting kit, each level after it improves one ability, unit or
 * defense. With `xp`, the ones already unlocked are marked.
 */
export function RankList({
  profile,
  xp,
  t,
  stageText,
}: {
  profile: Profile;
  xp?: number;
  t: Translate;
  stageText: Translate;
}) {
  const level = xp === undefined ? null : levelForXp(xp);
  const ranks = [...profile.ranks].sort((a, b) => a.level - b.level);
  if (ranks.length === 0) return null;
  return (
    <ol className="rank-list" data-testid={`ranks-${profile.id}`}>
      {ranks.map((rank) => {
        const open = level !== null && rank.level <= level;
        return (
          <li key={rank.level} className={level === null ? '' : open ? 'unlocked' : 'locked'}>
            <span className="rank-level">{t('progress.levelShort', { level: rank.level })}</span>
            <span>
              <strong>{stageText(rank.name)}</strong> {stageText(rank.description)}
            </span>
            {level !== null && (
              <span className="rank-state">{open ? t('progress.unlocked') : t('progress.locked')}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
