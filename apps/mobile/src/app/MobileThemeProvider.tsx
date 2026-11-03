import { type ReactNode } from 'react';
import { ThemeProvider } from '@lobehub/ui';

/**
 * Rendering is pinned to light while the mobile dark color contract is
 * unfinished. LobeUI/antd must never enter dark mode independently, or its
 * dark components clash with the light-only custom CSS. The persisted theme
 * preference stays owned by the device settings runtime and is restored here
 * together with the RENDERED_COLOR_SCHEME gate.
 */
export function MobileThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider themeMode="light">
      {children}
    </ThemeProvider>
  );
}
