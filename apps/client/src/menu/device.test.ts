import { describe, expect, it } from 'vitest';
import { isPcWithMouse } from './device';

const mouse = () => true;
const touch = (query: string) => !query.includes('fine') && !query.includes('hover: hover');

describe('isPcWithMouse', () => {
  it('accepts a Windows PC with a mouse, also with a touch screen', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
    expect(isPcWithMouse({ userAgent: ua, maxTouchPoints: 0 }, mouse)).toBe(true);
    expect(isPcWithMouse({ userAgent: ua, maxTouchPoints: 10 }, mouse)).toBe(true);
  });
  it('rejects phones and tablets, even with a mouse attached', () => {
    for (const ua of [
      'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    ])
      expect(isPcWithMouse({ userAgent: ua, maxTouchPoints: 5 }, mouse)).toBe(false);
    const iPad =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
    expect(isPcWithMouse({ userAgent: iPad, maxTouchPoints: 5 }, mouse)).toBe(false);
    expect(isPcWithMouse({ userAgent: iPad, maxTouchPoints: 0 }, mouse)).toBe(true);
  });
  it('rejects a touch-first device whatever it calls itself', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
    expect(isPcWithMouse({ userAgent: ua, maxTouchPoints: 5 }, touch)).toBe(false);
  });
});
