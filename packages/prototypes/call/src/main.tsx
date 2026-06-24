import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CallPrototype } from './CallPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CallPrototype />
  </StrictMode>,
);
