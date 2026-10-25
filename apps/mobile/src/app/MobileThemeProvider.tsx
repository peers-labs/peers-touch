import { useSyncExternalStore, type ReactNode } from 'react';
import { ThemeProvider } from '@lobehub/ui';
import {
  readDeviceSettingsRuntimeSnapshot,
  subscribeDeviceSettingsRuntime,
} from '../runtimes/deviceSettingsRuntime';

/** Render the committed device preference through the existing UI theme owner. */
export function MobileThemeProvider({ children }: { children: ReactNode }) {
  const snapshot = useSyncExternalStore(
    subscribeDeviceSettingsRuntime, readDeviceSettingsRuntimeSnapshot,
  );
  const preference = snapshot.preferences?.theme ?? 'system';
  return (
    <ThemeProvider themeMode={preference === 'system' ? 'auto' : preference}>
      {children}
    </ThemeProvider>
  );
}
