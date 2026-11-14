/**
 * Mobile north-star presentation provider.
 *
 * Mounts the single peers-ui UIProvider for the product with:
 *  - light theme (mobile dark color contract is unfinished by product decision);
 *  - north-star flat material variables injected as scoped CSS custom props;
 *  - the one window feedback channel (toasts/confirm dialogs render inside the
 *    provider overlay host).
 *
 * The companion stylesheet (mobile-northstar.css) only sets provider geometry
 * and mobile-owned `--pt-m-*` geometry tokens. It never targets `.pt-*`
 * primitives (see docs/knowledge invariant: app layer must not restyle
 * primitives).
 */
import { type ReactNode } from 'react';
import { UIProvider, northStarVariables } from '@peers-touch/ui';

import { mobileFeedbackChannel } from './feedback/mobileFeedback';
import './mobile-northstar.css';

export function MobileNorthStarProvider({ children }: { children: ReactNode }) {
  return (
    <UIProvider
      theme="light"
      inputFocus="explicit"
      className="m-northstar"
      style={northStarVariables('light', { material: 'flat' })}
      feedback={mobileFeedbackChannel}
    >
      {children}
    </UIProvider>
  );
}
