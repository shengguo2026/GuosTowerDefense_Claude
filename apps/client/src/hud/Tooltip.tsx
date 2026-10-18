import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';

const HOVER_MS = 450;
const LONG_PRESS_MS = 500;

/**
 * Tooltips on hover, and on long-press for touch screens (spec §15). The text also goes to `aria-describedby`, so
 * screen readers read it without hovering.
 */
export function Tooltip({ text, children }: { text: string; children: ReactElement }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useRef(`tip-${Math.random().toString(36).slice(2, 9)}`);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const open = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (rect) setShown({ x: rect.left + rect.width / 2, y: rect.top });
  };
  const close = () => {
    window.clearTimeout(timer.current);
    setShown(null);
  };

  return (
    <span
      ref={anchor}
      className="tooltip-anchor"
      aria-describedby={id.current}
      onPointerEnter={(e) => {
        if (e.pointerType !== 'mouse') return;
        timer.current = window.setTimeout(open, HOVER_MS);
      }}
      onPointerLeave={close}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse') return close();
        timer.current = window.setTimeout(open, LONG_PRESS_MS);
      }}
      onPointerUp={(e) => {
        if (e.pointerType !== 'mouse') {
          window.clearTimeout(timer.current);
          if (shown) window.setTimeout(close, 1800);
        }
      }}
      onContextMenu={(e) => shown && e.preventDefault()}
    >
      {children}
      <span id={id.current} className="visually-hidden">
        {text}
      </span>
      {shown &&
        createPortal(
          <span className="tooltip" role="tooltip" style={{ left: shown.x, top: shown.y }}>
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
