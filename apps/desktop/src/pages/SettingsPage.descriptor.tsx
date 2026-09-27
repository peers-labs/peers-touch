// PageDescriptor for the settings page.
//
// `preload: 'idle'` — settings sections trigger many fetches on first
// visit; mounting during the first idle window warms the tree without
// blocking firstPaint. `keepAlive: 'forever'` so highlight scroll
// position and section state survive tab switches.
// The runtime ownership entry lives in `runtimes/settingsRuntime.ts`.

import { registerPage } from '../kernel/page';
import { SettingsPageContainer } from './SettingsPageContainer';

export function registerSettingsPage(): void {
  registerPage({
    id: 'settings',
    title: 'Settings',
    factory: () => <SettingsPageContainer />,
    preload: 'idle',
    keepAlive: 'forever',
    runtimes: ['settings', 'chat-storage'],
  });
}
