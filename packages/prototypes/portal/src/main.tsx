import React from 'react';
import { createRoot } from 'react-dom/client';
import { PrototypePortal } from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PrototypePortal />
  </React.StrictMode>,
);
