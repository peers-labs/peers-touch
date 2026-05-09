// Container component for the settings page descriptor — bridges the
// kernel `usePageContext()` hook into `SettingsPage`'s prop signature.
// Kept in its own file so `SettingsPage.descriptor.tsx` exports only
// the register function (react-refresh requires modules to either
// export only components or only non-components).

import { usePageContext } from '../kernel/usePageContext';
import { SettingsPage } from './SettingsPage';

export function SettingsPageContainer() {
  const { navigation } = usePageContext();
  return (
    <SettingsPage
      activeTab={navigation.settingsNav.tab}
      highlightId={navigation.settingsNav.highlightId}
      onNavConsumed={() => undefined}
    />
  );
}
