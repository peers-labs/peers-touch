// PageDescriptor for the Custom Plugins management page (P3-M3).
//
// Allows users to define, test, and manage custom tool plugins
// that expose JSON Schema endpoints. Loaded lazily since it is
// an advanced settings surface.

import { registerPage } from '../kernel/page';
import { CustomPluginsPageContainer } from './CustomPluginsPageContainer';

export function registerCustomPluginsPage(): void {
  registerPage({
    id: 'custom-plugins',
    title: 'Custom Plugins',
    factory: () => <CustomPluginsPageContainer />,
    preload: 'on-visit',
    keepAlive: { lru: 1 },
    runtimes: [],
  });
}
