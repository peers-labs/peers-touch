// PageContext provider — broadcasts the shared
// router/navigation/applet-pins tuple to all descriptor factories.
//
// `useHashRouter`, `useNavigation`, and `useAppletPins` are stateful
// hooks; calling them per-page would create divergent copies. They are
// invoked once in `<ReadyView />` and the resulting tuple is shared
// here so each descriptor's container can call `usePageContext()`
// instead of duplicating state.

import type { ReactNode } from 'react';

import { PageContextRef, type PageContextValue } from './PageContextRef';

export type { PageContextValue };

export function PageContextProvider(
  props: { value: PageContextValue; children: ReactNode },
) {
  return (
    <PageContextRef.Provider value={props.value}>
      {props.children}
    </PageContextRef.Provider>
  );
}
