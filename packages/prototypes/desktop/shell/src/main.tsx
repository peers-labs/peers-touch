import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';
import { DesktopShell } from './Shell';

const antdTheme = {
  token: {
    colorPrimary: '#6b5bd6',
    colorInfo: '#6b5bd6',
    borderRadius: 8,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  components: {
    Button: {
      borderRadius: 8,
    },
  },
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider
      theme={antdTheme}
      style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <DesktopShell initialPage="agent" />
    </ThemeProvider>
  </StrictMode>,
);
