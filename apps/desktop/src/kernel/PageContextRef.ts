// Internal context object for `kernel/PageContext.tsx` and
// `kernel/usePageContext.ts`. Kept as a separate, component-free
// module so react-refresh's "components-only" rule applies cleanly to
// the JSX provider and hook modules.

import { createContext } from 'react';

import type { AppletPins, HashRouter, Navigation } from '../types/navigation';

export interface PageContextValue {
  router: HashRouter;
  navigation: Navigation;
  appletPins: AppletPins;
}

export const PageContextRef = createContext<PageContextValue | null>(null);
