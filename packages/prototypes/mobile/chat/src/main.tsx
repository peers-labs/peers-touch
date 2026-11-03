import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MobilePrototype } from './MobilePrototype';
import { initVisualViewport } from './viewport';

initVisualViewport();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MobilePrototype />
  </StrictMode>,
);
