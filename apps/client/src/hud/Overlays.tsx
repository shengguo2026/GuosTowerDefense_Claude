import type { Translate } from '@gtd/i18n';
import { useEffect, useRef } from 'react';
import { Art } from '../art/Art';

interface PauseProps {
  canPause: boolean;
  t: Translate;
  onResume(): void;
  onManual(): void;
  onSettings(): void;
  onRestart(): void;
  onQuit(): void;
}

/**
 * Pause menu (Esc or F10). In single player the match stands still while it is open; against another person it is
 * only a menu and the match goes on.
 */
export function PauseMenu({ canPause, t, onResume, onManual, onSettings, onRestart, onQuit }: PauseProps) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog panel pause-menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-title"
        data-testid="pause-menu"
      >
        <h2 id="pause-title">{canPause ? t('pause.paused') : t('pause.title')}</h2>
        {!canPause && <p className="hint">{t('pause.notPaused')}</p>}
        <div className="menu-buttons">
          <button ref={first} type="button" className="action launch" onClick={onResume} data-testid="resume">
            {t('pause.resume')}
          </button>
          <button type="button" className="action secondary" onClick={onManual} data-testid="pause-manual">
            {t('menu.manual')}
          </button>
          <button
            type="button"
            className="action secondary"
            onClick={onSettings}
            data-testid="pause-settings"
          >
            {t('settings.title')}
          </button>
          <button type="button" className="action secondary" onClick={onRestart} data-testid="restart">
            {t('pause.restart')}
          </button>
          <button type="button" className="action secondary" onClick={onQuit} data-testid="quit">
            {t('pause.quit')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface HintProps {
  text: string;
  t: Translate;
  onDismiss(): void;
}

/** A first-time hint from Chief Warden Guo. It shows once; the settings can show all hints again. */
export function HintToast({ text, t, onDismiss }: HintProps) {
  return (
    <aside className="hint-toast panel" role="status" data-testid="hint">
      <Art id="GUO-4-TIP" alt="" ratio={1} className="guo-mini" fallback="G" />
      <p>{text}</p>
      <button type="button" className="small" onClick={onDismiss} data-testid="hint-ok">
        {t('hint.ok')}
      </button>
    </aside>
  );
}

interface TutorialProps {
  text: string;
  step: number;
  total: number;
  waitsForNext: boolean;
  t: Translate;
  onNext(): void;
  onSkip(): void;
}

/** Guo explains one step at a time. Steps that only explain wait for Next (the match waits too). */
export function TutorialPanel({ text, step, total, waitsForNext, t, onNext, onSkip }: TutorialProps) {
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (waitsForNext) next.current?.focus();
  }, [waitsForNext, step]);
  return (
    <aside className="tutorial-panel panel" aria-live="polite" data-testid="tutorial">
      <Art id="GUO-4-TIP" alt="" ratio={1} className="guo-mini" fallback="G" />
      <div className="tutorial-body">
        <p className="tutorial-kicker">
          {t('guo.name')} · {t('tutorial.step', { step: step + 1, total })}
        </p>
        <p data-testid="tutorial-text">{text}</p>
        <div className="row">
          {waitsForNext ? (
            <button
              ref={next}
              type="button"
              className="small primary-small"
              onClick={onNext}
              data-testid="tutorial-next"
            >
              {step + 1 === total ? t('tutorial.finish') : t('tutorial.next')}
            </button>
          ) : (
            <span className="muted">{t('tutorial.doIt')}</span>
          )}
          <button type="button" className="small" onClick={onSkip} data-testid="tutorial-skip">
            {t('tutorial.skip')}
          </button>
        </div>
      </div>
    </aside>
  );
}

interface OfferProps {
  t: Translate;
  onAttacker(): void;
  onDefender(): void;
  onLater(): void;
}

/** Asked once on first launch: start with a guided tutorial? */
export function TutorialOffer({ t, onAttacker, onDefender, onLater }: OfferProps) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog panel tutorial-offer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="offer-title"
        data-testid="tutorial-offer"
      >
        <Art id="GUO-1-BRIEFING" alt="" ratio={1} className="guo-portrait" fallback="G" />
        <h2 id="offer-title">{t('tutorial.offerTitle')}</h2>
        <p>{t('tutorial.offerText')}</p>
        <div className="menu-buttons">
          <button type="button" className="action launch" onClick={onAttacker} data-testid="offer-attacker">
            {t('tutorial.asAttacker')}
          </button>
          <button type="button" className="action launch" onClick={onDefender} data-testid="offer-defender">
            {t('tutorial.asDefender')}
          </button>
          <button type="button" className="action secondary" onClick={onLater} data-testid="offer-later">
            {t('tutorial.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
