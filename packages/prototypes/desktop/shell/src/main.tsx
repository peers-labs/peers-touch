import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DesktopShell } from './Shell';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DesktopShell initialPage="agent" />
  </StrictMode>,
);
