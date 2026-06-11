import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteCLIPage } from './Page';

const root = document.getElementById('root');
if (!root) {
  throw new Error('remote-cli root element is missing');
}

createRoot(root).render(createElement(RemoteCLIPage, { onBack: () => undefined }));
