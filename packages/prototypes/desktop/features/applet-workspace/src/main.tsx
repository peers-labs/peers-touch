import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppletWorkspacePrototype } from './AppletWorkspaceStandalone';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppletWorkspacePrototype />
  </StrictMode>,
);
