/**
 * Hot-seat needs a PC with a keyboard and a mouse (spec §5.2). Phones and tablets never qualify, even with a stylus,
 * a mouse or a keyboard cover: the split screen does not fit their screens.
 */
export function isPcWithMouse(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator,
  media: (query: string) => boolean = (query) => window.matchMedia(query).matches,
): boolean {
  if (/Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/i.test(nav.userAgent)) return false;
  // iPadOS reports itself as a Mac; a real Mac has no touch screen.
  if (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1) return false;
  // The main pointer must be a mouse: a touch-first device with a fine pointer attached still counts as a tablet.
  return media('(pointer: fine)') && media('(hover: hover)');
}
