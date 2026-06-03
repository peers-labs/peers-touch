import type { ReactNode } from 'react';
import { useMemo } from 'react';

import { MobileI18nProvider } from './mobileI18n';
import { PlatformContext } from '../services/platform/PlatformContext';
import { createTauriMobilePlatform } from '../services/platform/mobilePlatform';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  const platform = useMemo(() => createTauriMobilePlatform(), []);

  return (
    <MobileI18nProvider>
      <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
    </MobileI18nProvider>
  );
}
