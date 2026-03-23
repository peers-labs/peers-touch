import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';
import App from './App';
import SharePage from './pages/SharePage';
import './modules';
import './applets';
import './index.css';

function Root() {
  const path = window.location.pathname;
  const shareMatch = path.match(/^\/share\/s\/([A-Za-z0-9]+)$/);
  if (shareMatch) {
    return <SharePage token={shareMatch[1]} />;
  }
  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </StrictMode>,
);
