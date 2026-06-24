import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WelcomeLoginPrototype } from './WelcomeLoginPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WelcomeLoginPrototype />
  </StrictMode>,
);
