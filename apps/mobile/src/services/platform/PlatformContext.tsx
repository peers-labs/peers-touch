import { createContext, useContext } from 'react';

import type { MobilePlatform } from './mobilePlatform';

export const PlatformContext = createContext<MobilePlatform | null>(null);

export function useMobilePlatform(): MobilePlatform {
  const platform = useContext(PlatformContext);

  if (!platform) {
    throw new Error('Mobile platform adapter is not registered');
  }

  return platform;
}
