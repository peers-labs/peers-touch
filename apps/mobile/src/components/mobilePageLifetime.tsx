import { Activity, createContext, useContext, useEffect, useRef, type ReactNode } from 'react';

export interface MobilePageLifetime {
  readonly visible: boolean;
  readonly disposals: Map<symbol, () => void>;
}

export const MobilePageLifetimeContext = createContext<MobilePageLifetime | null>(null);

export function MobilePageActivity({ visible, children }: { visible: boolean; children: ReactNode }) {
  const parent = useContext(MobilePageLifetimeContext);
  const selected = useRef(visible);
  selected.current = visible;
  const lifetime = useRef<MobilePageLifetime>({
    get visible() { return selected.current && parent?.visible !== false; },
    disposals: new Map(),
  }).current;
  useMobilePageDisposal(() => {
    lifetime.disposals.forEach(dispose => dispose());
    lifetime.disposals.clear();
  });
  return <MobilePageLifetimeContext.Provider value={lifetime}>
    <Activity mode={visible ? 'visible' : 'hidden'}>{children}</Activity>
  </MobilePageLifetimeContext.Provider>;
}

/**
 * Presentation assets survive Activity suspension. Actual removal of a visible
 * child or its owning retained frame releases them. Capture/subscription effects
 * continue to use normal useEffect cleanup, so hiding stops active work.
 */
export function useMobilePageDisposal(dispose: () => void): void {
  const lifetime = useContext(MobilePageLifetimeContext);
  const latest = useRef(dispose);
  latest.current = dispose;
  const token = useRef(Symbol('mobile-page-asset'));
  useEffect(() => {
    const key = token.current;
    let disposed = false;
    const release = () => {
      if (disposed) return;
      disposed = true;
      if (lifetime?.disposals.get(key) === release) lifetime.disposals.delete(key);
      latest.current();
    };
    lifetime?.disposals.set(key, release);
    return () => {
      if (lifetime && !lifetime.visible) return;
      release();
    };
  }, [lifetime]);
}
