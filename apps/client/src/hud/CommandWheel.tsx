import type { Translate } from '@gtd/i18n';
import { useEffect, useRef } from 'react';

export interface WheelItem {
  id: string;
  label: string;
  disabled?: boolean;
  onPick(): void;
}

interface Props {
  x: number;
  y: number;
  title: string;
  items: WheelItem[];
  t: Translate;
  onClose(): void;
}

const RADIUS = 78;

/**
 * Right click on an own asset (spec §5.2): the asset's orders in a ring around the pointer, so the Defender never
 * needs a key. A click outside or Esc closes it.
 */
export function CommandWheel({ x, y, title, items, t, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    // The opening right click must not close the wheel at once.
    const timer = window.setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('keydown', key, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  // Keep the whole ring on screen.
  const margin = RADIUS + 60;
  const left = Math.min(Math.max(x, margin), window.innerWidth - margin);
  const top = Math.min(Math.max(y, margin), window.innerHeight - margin);
  return (
    <div
      ref={ref}
      className="command-wheel"
      style={{ left, top }}
      role="menu"
      aria-label={title}
      data-testid="command-wheel"
      onContextMenu={(event) => event.preventDefault()}
    >
      <button type="button" className="wheel-centre" onClick={onClose} aria-label={t('hud.cancel')}>
        <span>{title}</span>
      </button>
      {items.map((item, i) => {
        const angle = (i / items.length) * Math.PI * 2 - Math.PI / 2;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="wheel-item"
            style={{ transform: `translate(${Math.cos(angle) * RADIUS}px, ${Math.sin(angle) * RADIUS}px)` }}
            disabled={item.disabled}
            onClick={() => {
              item.onPick();
              onClose();
            }}
            data-testid={`wheel-${item.id}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
