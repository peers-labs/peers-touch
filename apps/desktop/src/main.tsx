import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';
import { I18nextProvider } from 'react-i18next';
import type { i18n as I18nInstance } from 'i18next';
import { log } from './utils/logger';
import { initI18n } from './i18n';
import { registerAppletElements } from './applet/register-elements';
// Side-effect: register global error / unhandledrejection handlers once.
import './kernel/events/global-error';
import App from './App';
import SharePage from './pages/SharePage';
import './modules';
import './index.css';
import { markPhaseEnd, markPhaseStart } from './kernel/boot';
import { configureFrontendTelemetryUploader } from './kernel/frontendTelemetry';
import {
  installFrontendRuntimeProfiler,
  markInvokeCompleted,
  markInvokeFailed,
  markInvokeStarted,
} from './kernel/frontendRuntimeProfiler';
import { uploadFrontendTelemetryEvents } from './services/desktop_api';

// Register custom elements early — before any React component attempts to render <lynx-host>.
registerAppletElements();
installFrontendRuntimeProfiler();
configureFrontendTelemetryUploader(uploadFrontendTelemetryEvents);

if (import.meta.env.VITE_ACCEPTANCE_HARNESS === '1') {
  void import('./acceptance/chatAcceptanceHarness').then(({ installChatAcceptanceHarness }) => {
    installChatAcceptanceHarness();
  });
}

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
      const startedAt = performance.now();
      const interactionId = markInvokeStarted(cmd, { runtime: 'browser-gateway' });
      const gatewayArgs = args && Object.keys(args).length === 1 && 'input' in args
        ? args.input as Record<string, unknown>
        : args ?? {};
      try {
        const res = await fetch(GATEWAY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, args: gatewayArgs }),
        });
        if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
        const result = await res.json();
        markInvokeCompleted(cmd, performance.now() - startedAt, {
          interactionId,
          runtime: 'browser-gateway',
        });
        return result;
      } catch (error) {
        markInvokeFailed(cmd, performance.now() - startedAt, {
          interactionId,
          runtime: 'browser-gateway',
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
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

if (import.meta.env.VITE_ACCEPTANCE_HARNESS === '1') {
  void import('./acceptance/chatAcceptanceHarness').then(({ installChatAcceptanceHarness }) => {
    installChatAcceptanceHarness();
  });
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

class ErrorBoundary extends Component<{ children: ReactNode; i18n: I18nInstance }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    log.error('app', 'React render crash', { error: error.message, stack: error.stack });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#c00', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            <h2>{this.props.i18n.t('desktop.errorBoundary.title', { ns: 'common' })}</h2>
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
  const initializedI18n = await initI18n();

  window.__PT_BOOT_STATUS__?.('Rendering UI…');
  const path = window.location.pathname;
  const shareMatch = path.match(/^\/share\/s\/([A-Za-z0-9]+)$/);

  window.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });

  markPhaseEnd('shell');

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <ErrorBoundary i18n={initializedI18n}>
          <I18nextProvider i18n={initializedI18n}>
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
