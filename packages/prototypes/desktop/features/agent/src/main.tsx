// Agent Prototype — Standalone Dev Entry
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPrototype } from './AgentPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AgentPrototype />
  </StrictMode>,
);
