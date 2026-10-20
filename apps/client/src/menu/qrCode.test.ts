import { describe, expect, it } from 'vitest';
import { qrPath } from './QrCode';

describe('qrPath', () => {
  it('draws a join address as a scannable code with a quiet zone', () => {
    const { path, size } = qrPath('http://192.168.1.20:3000/');
    // Version 2 (25 modules) fits this address at error correction M; 4 modules of border on each side.
    expect(size).toBe(25 + 8);
    // The top-left finder pattern starts right after the border.
    expect(path.startsWith('M4 4h1v1h-1z')).toBe(true);
    expect(qrPath('http://192.168.1.20:3001/').path).not.toBe(path);
  });
});
