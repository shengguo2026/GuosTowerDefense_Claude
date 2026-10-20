import type { Translate } from '@gtd/i18n';
import { useState } from 'react';

/**
 * Tablets and phones are landscape-first (spec §3): held upright, the game asks to be turned sideways. The hint shows
 * only in portrait (CSS) and can be tapped away for the rest of the visit.
 */
export function RotateHint({ t }: { t: Translate }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <button
      type="button"
      className="rotate-hint"
      onClick={() => setDismissed(true)}
      data-testid="rotate-hint"
    >
      <svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
        <rect x="22" y="8" width="20" height="36" rx="3" fill="none" stroke="currentColor" strokeWidth="3" />
        <rect x="12" y="34" width="36" height="20" rx="3" fill="currentColor" opacity="0.35" />
        <path d="M50 18a14 14 0 0 1 4 12" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M51 31l3 0l1-4" fill="none" stroke="currentColor" strokeWidth="3" />
      </svg>
      <strong>{t('rotate.title')}</strong>
      <span>{t('rotate.dismiss')}</span>
    </button>
  );
}
