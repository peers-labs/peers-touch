/**
 * MobileApp — clean Chinese mobile product surface on the latest peers-ui.
 *
 * Entry only. Implementation follows the same headless architecture as the
 * main product and the evidence harness:
 *   app/model.ts    domain entities + seed factory
 *   app/state.ts    pure reducer over a discriminated action union
 *   app/screens.tsx stateless views
 *   app/CallScreen, app/primitives  overlay + shared view pieces
 */
import './mobile-app.css';
import { northStarVariables, UIProvider } from '@peers-touch/ui';
import { MobileAppView } from './app/MobileAppView';

export function MobileApp() {
  // Own provider inside the phone frame so Dialog/Menu/Popover portals mount
  // within the phone screen (data-phone-body), not the outer board host.
  return (
    <UIProvider theme="light" className="ma-scope pt-north-star" style={northStarVariables('light')}>
      <MobileAppView />
    </UIProvider>
  );
}

export default MobileApp;
