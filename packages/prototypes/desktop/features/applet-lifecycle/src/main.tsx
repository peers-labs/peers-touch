import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppletLifecyclePrototype } from './AppletLifecyclePrototype';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppletLifecyclePrototype />
  </StrictMode>,
);
