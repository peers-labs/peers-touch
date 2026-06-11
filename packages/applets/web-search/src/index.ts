/**
 * Web Search Applet — Frontend Extension
 *
 * Self-registers settings panel, dedicated page, and sidebar icon
 * into the applet frontend registry.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { WebSearchAppletPage } from './Page';

const root = document.getElementById('root');
if (!root) {
  throw new Error('web-search root element is missing');
}

createRoot(root).render(createElement(WebSearchAppletPage, { onBack: () => undefined }));
