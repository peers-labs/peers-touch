import { useEffect, useMemo, type ReactNode } from 'react';

import { MobileI18nProvider } from './mobileI18n';
import { getMobileLifecycleKernel } from './lifecycle/MobileLifecycleKernel';
import {
  createMobileRuntimeDescriptors,
  fenceMobileRuntimeProjections,
  resolveMobileLaunchState,
} from '../runtimes/runtimeRegistry';
import {
  advanceLifecycleGeneration,
  fetchLifecycleGeneration,
} from '../runtimes/nativeLifecycleBridge';
import { PlatformContext } from '../services/platform/PlatformContext';
import { createTauriMobilePlatform } from '../services/platform/mobilePlatform';

interface AppProvidersProps {
  children: ReactNode;
}

/**
 * Root providers for the mobile app.
 *
 * Initializes the platform adapter and requests graph lifecycle operations
 * through the MobileLifecycleKernel owner.
 *
 * The native event bridge installation that was previously here is now owned
 * by the native-event-bridge MobileRuntimeDescriptor and bootstrapped by the kernel.
 */
export function AppProviders({ children }: AppProvidersProps) {
  const platform = useMemo(() => createTauriMobilePlatform(), []);

  useEffect(() => {
    const kernel = getMobileLifecycleKernel();
    kernel.configureRuntimeGraph({
      createDescriptors: createMobileRuntimeDescriptors,
      readGeneration: fetchLifecycleGeneration,
      advanceGeneration: advanceLifecycleGeneration,
      resolveLaunchState: () => resolveMobileLaunchState(kernel.getSnapshot()),
      fenceProjections: fenceMobileRuntimeProjections,
    });
    void kernel.startRuntimeGraph();

    return () => {
      void kernel.stopRuntimeGraph();
    };
  }, []);

  return (
    <MobileI18nProvider>
      <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
    </MobileI18nProvider>
  );
}
