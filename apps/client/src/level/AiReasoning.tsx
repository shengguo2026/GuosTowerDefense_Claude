import type { AiThought } from '@gtd/ai';
import type { Translate } from '@gtd/i18n';
import { useState } from 'react';
import { formatSeconds } from './MatchControls';

interface Props {
  thoughts: AiThought[];
  t: Translate;
}

/**
 * Developer view of the computer's reasoning: what it saw, weighed and chose, newest first. The lines are written by
 * the AI for developers and stay in English.
 */
export function AiReasoning({ thoughts, t }: Props) {
  // Open on large screens; on phones and tablets it would cover the map, so it starts folded.
  const [open, setOpen] = useState(() => window.innerWidth > 900);
  return (
    <aside className={`ai-reasoning panel ${open ? 'open' : ''}`} data-testid="ai-reasoning">
      <button
        type="button"
        className="ai-reasoning-toggle"
        onClick={() => setOpen((shown) => !shown)}
        aria-expanded={open}
      >
        {t('ai.reasoning')} <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ol className="ai-thoughts" lang="en">
          {thoughts.length === 0 && <li className="muted">{t('ai.waiting')}</li>}
          {[...thoughts].reverse().map((thought) => (
            <li key={thought.tick} data-testid="ai-thought">
              <span className="ai-time">{formatSeconds(thought.tick)}</span>
              {thought.lines.map((line, i) => (
                <span key={i} className="ai-line">
                  {line}
                </span>
              ))}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
