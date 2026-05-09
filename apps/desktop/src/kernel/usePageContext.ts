// `usePageContext` — read the shared router/navigation/applet-pins
// tuple injected by `<PageContextProvider />` in `<ReadyView />`.
//
// Lives in its own non-JSX module so react-refresh's
// "only-export-components" rule applies cleanly to the JSX provider
// module.

import { useContext } from 'react';

import { PageContextRef, type PageContextValue } from './PageContextRef';

export function usePageContext(): PageContextValue {
  const ctx = useContext(PageContextRef);
  if (!ctx) {
    throw new Error(
      'usePageContext() called outside <PageContextProvider>. PageHost must wrap pages with PageContextProvider.',
    );
  }
  return ctx;
}
