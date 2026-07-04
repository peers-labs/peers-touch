import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppletLifecyclePrototype } from './AppletLifecyclePrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppletLifecyclePrototype />
  </StrictMode>,
);
