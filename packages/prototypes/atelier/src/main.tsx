import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AtelierPage } from './Page';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AtelierPage />
  </StrictMode>,
);
