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

export interface PageActivityState {
  readonly active: boolean;
  readonly descriptorId: string;
  readonly pageId: string;
}

const PageActivityContext = createContext<PageActivityState | null>(null);

export function PageActivityProvider({
  active,
  children,
  descriptorId,
  pageId,
}: PageActivityState & { readonly children: ReactNode }): ReactNode {
  const value = useMemo(
    () => ({ active, descriptorId, pageId }),
    [active, descriptorId, pageId],
  );
  return (
    <PageActivityContext.Provider value={value}>
      {children}
    </PageActivityContext.Provider>
  );
}

export function usePageActivity(): PageActivityState {
  return useContext(PageActivityContext) ?? {
    active: true,
    descriptorId: 'unowned',
    pageId: 'unowned',
  };
}

export function useIsPageActive(): boolean {
  return usePageActivity().active;
}

export function usePageActiveStoreSelector<TState, TSelected>(
  store: Pick<StoreApi<TState>, 'getState' | 'subscribe'>,
  selector: (state: TState) => TSelected,
  equality: (left: TSelected, right: TSelected) => boolean = Object.is,
): TSelected {
  const { active } = usePageActivity();
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
