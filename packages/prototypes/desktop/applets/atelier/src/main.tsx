import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AtelierPage } from './Page';
import { createAtelierRuntimeForEnvironment } from './runtimeBootstrap';

const runtime = createAtelierRuntimeForEnvironment();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AtelierPage runtime={runtime} />
  </StrictMode>,
);
