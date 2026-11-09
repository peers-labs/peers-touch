/**
 * MobileApp — clean Chinese mobile product surface on the latest peers-ui.
 *
 * Entry only. Implementation follows the same headless architecture as the
 * main product and the evidence harness:
 *   app/model.ts    domain entities + seed factory
 *   app/state.ts    pure reducer over a discriminated action union
 *   app/screens.tsx stateless views
 *   app/CallScreen            full-screen call overlay
 *
 * Device chrome (status bar, nav bar, tab bar, bottom sheet) and every
 * control shape come from @peers-touch/ui; ma-* CSS only lays pages out.
 */
import './mobile-app.css';
import { northStarVariables, UIProvider } from '@peers-touch/ui';
import { MobileAppView } from './app/MobileAppView';
import type { ProductScenario } from './app/model';

export function MobileApp({ scenario = 'default' }: { scenario?: ProductScenario } = {}) {
  // Own provider inside the phone frame so Dialog/Menu/Popover portals mount
  // within the phone screen (data-phone-body), not the outer board host.
  return (
    <UIProvider theme="light" className="ma-scope pt-north-star"
      style={northStarVariables('light', { material: 'flat' })}>
      <MobileAppView scenario={scenario} />
    </UIProvider>
  );
}

export default MobileApp;
