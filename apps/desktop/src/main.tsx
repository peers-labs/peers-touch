import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';
import { log } from './utils/logger';
import App from './App';
import SharePage from './pages/SharePage';
import './modules';
import './index.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    log.error('app', 'React render crash', { error: error.message, stack: error.stack });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#c00', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2>App crashed</h2>
          <p>{this.state.error.message}</p>
          <pre style={{ fontSize: 12 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

window.addEventListener('error', (e) => {
  log.error('app', 'Uncaught error', { message: e.message, filename: e.filename, lineno: e.lineno });
});
window.addEventListener('unhandledrejection', (e) => {
  log.error('app', 'Unhandled rejection', { reason: String(e.reason) });
});

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
    <ErrorBoundary>
      <ThemeProvider>
        <Root />
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
);

if (typeof window.__PT_BOOT_READY__ === 'function') {
  window.__PT_BOOT_READY__();
}
