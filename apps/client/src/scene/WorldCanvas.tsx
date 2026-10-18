import { useEffect, useRef } from 'react';
import { createWorldView } from './createWorldView';

export function WorldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = createWorldView(canvas);
    return () => view.dispose();
  }, []);

  return <canvas ref={canvasRef} className="world-canvas" data-testid="world-canvas" />;
}
