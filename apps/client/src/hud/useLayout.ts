import { useEffect, useState } from 'react';
import { layoutFor, type Layout } from './hudState';

function current(): Layout {
  return layoutFor(window.innerWidth, window.innerHeight, window.matchMedia('(pointer: coarse)').matches);
}

/** Desktop, tablet or phone HUD, following the window as it is resized or turned. */
export function useLayout(): Layout {
  const [layout, setLayout] = useState<Layout>(current);
  useEffect(() => {
    const onResize = () => setLayout(current());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return layout;
}
