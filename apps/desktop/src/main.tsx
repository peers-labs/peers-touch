import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';
import { I18nextProvider } from 'react-i18next';
import { log } from './utils/logger';
import { initI18n } from './i18n';
// Side-effect: register global error / unhandledrejection handlers once.
import './kernel/events/global-error';
import App from './App';
import SharePage from './pages/SharePage';
import './modules';
import './index.css';
import { markPhaseEnd, markPhaseStart } from './kernel/boot';

// ── Browser Dev Gateway ──
// When running outside Tauri WebView (e.g. Chrome), patch
// __TAURI_INTERNALS__ so that invoke() routes through the
// Rust HTTP gateway at 127.0.0.1:3030.
//
// When this branch runs, we expose `__PT_GATEWAY_BASE__` so other modules
// (UserSquareAvatar) can serve binary content (avatars) through the
// gateway too — `convertFileSrc` no-ops here and the browser cannot
// render local filesystem paths.
if (typeof window !== 'undefined' && !('__TAURI_INTERNALS__' in window)) {
  const port = import.meta.env.VITE_GATEWAY_PORT || '3030';
  const GATEWAY = `http://127.0.0.1:${port}`;
  (window as any).__PT_GATEWAY_BASE__ = GATEWAY;
  (window as any).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cmd, args: args ?? {} }),
      });
      if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
      return res.json();
    },
    transformCallback: (callback?: (response: unknown) => void) => {
      const id = crypto.randomUUID();
      if (callback) (window as any)[`_${id}`] = callback;
      return id;
    },
    convertFileSrc: (path: string) => path,
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
}

declare global {
  interface Window {
    __PT_BOOT_READY__?: () => void;
    __PT_BOOT_ERROR__?: (detail: string) => void;
    __PT_BOOT_STATUS__?: (text: string) => void;
  }
}

// Report: module script started executing
window.__PT_BOOT_STATUS__?.('Initializing…');

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

async function bootstrap() {
  markPhaseStart('shell');

  window.__PT_BOOT_STATUS__?.('Loading language packs…');
  const i18n = await initI18n();

  window.__PT_BOOT_STATUS__?.('Rendering UI…');
  const path = window.location.pathname;
  const shareMatch = path.match(/^\/share\/s\/([A-Za-z0-9]+)$/);

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  markPhaseEnd('shell');

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            {shareMatch ? <SharePage token={shareMatch[1]} /> : <App />}
          </ThemeProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  if (typeof window.__PT_BOOT_READY__ === 'function') {
    window.__PT_BOOT_READY__();
  }
}

bootstrap().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error('app', 'Bootstrap failed', { error: msg, stack: err?.stack });
  // Surface the error in the boot fallback UI immediately — don't wait for 30s timeout
  if (typeof window.__PT_BOOT_ERROR__ === 'function') {
    window.__PT_BOOT_ERROR__('Bootstrap failed:\n' + msg + (err?.stack ? '\n\n' + err.stack : ''));
  }
});
