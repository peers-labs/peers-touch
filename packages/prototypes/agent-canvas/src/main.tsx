import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentCanvasPage } from './AgentCanvasPage';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgentCanvasPage />
  </StrictMode>,
);
