import { useEffect, useMemo, type ReactNode } from 'react';

import { MobileI18nProvider } from './mobileI18n';
import { getMobileLifecycleKernel } from './lifecycle/MobileLifecycleKernel';
import { createMobileRuntimeDescriptors } from '../runtimes/runtimeRegistry';
import { PlatformContext } from '../services/platform/PlatformContext';
import { createTauriMobilePlatform } from '../services/platform/mobilePlatform';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Root providers for the mobile app.
 *
 * Initializes the platform adapter, registers runtime descriptors with the
 * lifecycle kernel, and bootstraps runtimes on mount. Teardown runs on unmount.
 *
 * The native event bridge installation that was previously here is now owned
 * by the native-event-bridge MobileRuntimeDescriptor and bootstrapped by the kernel.
 */
export function AppProviders({ children }: AppProvidersProps) {
  const platform = useMemo(() => createTauriMobilePlatform(), []);

  useEffect(() => {
    const kernel = getMobileLifecycleKernel();

    // Only register + bootstrap if the kernel is in COLD state
    // (prevents double-bootstrap in StrictMode dev re-mounts)
    if (kernel.getPhase() !== 'COLD') return;

    const descriptors = createMobileRuntimeDescriptors();
    kernel.register(descriptors);
    void kernel.bootstrap();

    return () => {
      void kernel.teardown();
    };
  }, []);

  return (
    <MobileI18nProvider>
      <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
    </MobileI18nProvider>
  );
}
