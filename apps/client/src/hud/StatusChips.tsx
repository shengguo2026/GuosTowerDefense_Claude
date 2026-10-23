import type { Translate } from '@gtd/i18n';
import type { DefenseStatus, GroupStatus } from '@gtd/sim';

const SYMBOLS: Record<GroupStatus | DefenseStatus, string> = {
  slowed: '◔',
  boosted: '▲',
  concealed: '◌',
  revealed: '◉',
  pinned: '■',
  protected: '⛨',
  disrupted: '⚡',
  crowded: '⋙',
  ambushed: '!',
  hidden: '◍',
};

/** Running status effects as small chips: a symbol and a word, so colour is never the only sign (spec §17). */
export function StatusChips({
  statuses,
  t,
}: {
  statuses: readonly (GroupStatus | DefenseStatus)[];
  t: Translate;
}) {
  if (statuses.length === 0) return null;
  return (
    <span className="status-chips" data-testid="status-chips">
      {statuses.map((status) => (
        <span key={status} className={`status-chip status-${status}`} data-status={status}>
          <span aria-hidden="true">{SYMBOLS[status]}</span> {t(`status.${status}`)}
        </span>
      ))}
    </span>
  );
}
