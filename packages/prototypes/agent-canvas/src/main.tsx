import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentCanvasPrototype } from './AgentCanvasPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgentCanvasPrototype />
  </StrictMode>,
);
