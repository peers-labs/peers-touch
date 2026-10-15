import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';
import {
  createAntdTokenTheme,
  createDesignTokenCssVariables,
} from '../../../shared/design-tokens';
import { DesktopShell } from './Shell';

const antdTheme = createAntdTokenTheme('light');
const cssVariables = createDesignTokenCssVariables('light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider
      theme={antdTheme}
      style={{
        ...cssVariables,
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <DesktopShell />
    </ThemeProvider>
  </StrictMode>,
);
