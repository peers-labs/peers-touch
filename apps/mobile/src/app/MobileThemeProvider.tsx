import { useSyncExternalStore, type ReactNode } from 'react';
import { ThemeProvider } from '@lobehub/ui';
import {
  readDeviceSettingsRuntimeSnapshot, subscribeDeviceSettingsRuntime,
} from '../runtimes/deviceSettingsRuntime';

const mobileTheme = { primaryColor: 'geekblue', neutralColor: 'slate' } as const;

/** Both library tokens and native web surfaces observe the committed owner. */
export function MobileThemeProvider({ children }: { readonly children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeDeviceSettingsRuntime, readDeviceSettingsRuntimeSnapshot, readDeviceSettingsRuntimeSnapshot,
  );
  const preference = snapshot.preferences?.theme ?? 'system';
  return <ThemeProvider themeMode={preference === 'system' ? 'auto' : preference}
    customTheme={mobileTheme}>
    {children}
  </ThemeProvider>;
}
