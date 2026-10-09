import { useEffect, useState } from 'react';

export function visualKeyboardOverlap(
  layoutViewportHeight: number,
  visualViewportHeight: number,
  visualViewportOffsetTop: number,
): number {
  return Math.max(
    0,
    Math.ceil(layoutViewportHeight - visualViewportHeight - visualViewportOffsetTop),
  );
}

export function useVisualKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      setOverlap(0);
      return undefined;
    }

    const update = () => {
      const layoutViewportHeight = Math.max(
        window.innerHeight,
        document.documentElement.clientHeight,
      );
      const nextOverlap = visualKeyboardOverlap(
        layoutViewportHeight,
        viewport.height,
        viewport.offsetTop,
      );
      setOverlap((currentOverlap) => (
        currentOverlap === nextOverlap ? currentOverlap : nextOverlap
      ));
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return overlap;
}
