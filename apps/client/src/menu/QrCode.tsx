import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/** Modules of white border around the code, as QR readers expect. */
const QUIET_ZONE = 4;

/** The dark modules of a QR code for `text`, as one SVG path in module units (quiet zone included). */
export function qrPath(text: string): { path: string; size: number } {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const count = code.getModuleCount();
  let path = '';
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (code.isDark(row, col)) path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
    }
  }
  return { path, size: count + QUIET_ZONE * 2 };
}

/** A QR code a phone camera can scan, drawn crisp at any size. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { path, size } = useMemo(() => qrPath(text), [text]);
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      data-testid="qr-code"
      data-text={text}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#1b2433" />
    </svg>
  );
}
