import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardPrototype } from './DashboardPrototype';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DashboardPrototype />
  </StrictMode>,
);

