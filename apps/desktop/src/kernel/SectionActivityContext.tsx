import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { StoreApi } from 'zustand';
import { usePageActivity } from './PageActivityContext';

export interface SectionActivityState {
  readonly active: boolean;
  readonly sectionId: string;
  readonly surfaceId: string;
}

const SectionActivityContext = createContext<SectionActivityState | null>(null);

export function SectionActivityProvider({
  active,
  children,
  sectionId,
  surfaceId,
}: SectionActivityState & { readonly children: ReactNode }): ReactNode {
  const value = useMemo(
    () => ({ active, sectionId, surfaceId }),
    [active, sectionId, surfaceId],
  );
  return (
    <SectionActivityContext.Provider value={value}>
      {children}
    </SectionActivityContext.Provider>
  );
}

export function useSectionActivity(): SectionActivityState {
  return useContext(SectionActivityContext) ?? {
    active: true,
    sectionId: 'unowned',
    surfaceId: 'unowned',
  };
}

export function useSectionActiveStoreSelector<TState, TSelected>(
  store: Pick<StoreApi<TState>, 'getState' | 'subscribe'>,
  selector: (state: TState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  const pageActivity = usePageActivity();
  const sectionActivity = useSectionActivity();
  const active = pageActivity.active && sectionActivity.active;
  const selectorRef = useRef(selector);
  const equalityRef = useRef(equality);
  const lastSelectedRef = useRef<TSelected>(selector(store.getState()));
  selectorRef.current = selector;
  equalityRef.current = equality;

  const getSnapshot = useCallback(() => {
    if (!active) return lastSelectedRef.current;
    const next = selectorRef.current(store.getState());
    if (!equalityRef.current(lastSelectedRef.current, next)) {
      lastSelectedRef.current = next;
    }
    return lastSelectedRef.current;
  }, [active, store]);

  const subscribe = useCallback((notify: () => void) => {
    if (!active) return () => undefined;
    return store.subscribe(() => {
      const next = selectorRef.current(store.getState());
      if (equalityRef.current(lastSelectedRef.current, next)) return;
      lastSelectedRef.current = next;
      notify();
    });
  }, [active, store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
