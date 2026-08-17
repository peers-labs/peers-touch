import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, ToastHost } from '@lobehub/ui';
import { I18nextProvider } from 'react-i18next';
import { log } from './utils/logger';
import { initI18n } from './i18n';
import { ErrorBoundary } from './kernel/ErrorBoundary';
import { installBrowserGateway } from './kernel/gateway';
import { markPhaseEnd, markPhaseStart } from './kernel/boot';
import { registerAppletElements } from './applet/register-elements';
import {
  installFrontendRuntimeProfiler,
  teardownFrontendRuntimeProfiler,
} from './kernel/frontendRuntimeProfiler';
import { configureFrontendTelemetryUploader } from './kernel/frontendTelemetry';
import { uploadFrontendTelemetryEvents } from './services/desktop_api';
import './kernel/events/global-error';
import './modules';
import './index.css';
import App from './App';
import SharePage from './pages/SharePage';

declare global {
  interface Window {
    __PT_BOOT_READY__?: () => void;
    __PT_BOOT_ERROR__?: (detail: string) => void;
    __PT_BOOT_STATUS__?: (text: string) => void;
  }
}

// ── Platform Setup (synchronous, before any async work) ──

registerAppletElements();
installFrontendRuntimeProfiler();
configureFrontendTelemetryUploader(uploadFrontendTelemetryEvents);
installBrowserGateway();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    teardownFrontendRuntimeProfiler();
  });
}

if (import.meta.env.VITE_ACCEPTANCE_HARNESS === '1') {
  void import('./acceptance/registry').then(({ installAcceptanceHarnesses }) => {
    void installAcceptanceHarnesses();
  });
  void import('./acceptance/agentAcceptanceHarness').then(({ installAgentAcceptanceHarness }) => {
    installAgentAcceptanceHarness();
  });
}

window.__PT_BOOT_STATUS__?.('Initializing…');

// ── Bootstrap (async: i18n → render) ──

async function bootstrap() {
  markPhaseStart('shell');

  window.__PT_BOOT_STATUS__?.('Loading language packs…');
  const i18n = await initI18n();

  window.__PT_BOOT_STATUS__?.('Rendering UI…');
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  markPhaseEnd('shell');

  const shareMatch = window.location.pathname.match(/^\/share\/s\/([A-Za-z0-9]+)$/);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary i18n={i18n}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider>
            {shareMatch ? <SharePage token={shareMatch[1]} /> : <App />}
            <ToastHost />
          </ThemeProvider>
        </I18nextProvider>
      </ErrorBoundary>
    </StrictMode>,
  );

  window.__PT_BOOT_READY__?.();
}

bootstrap().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  log.error('app', 'Bootstrap failed', { error: msg, stack: err?.stack });
  window.__PT_BOOT_ERROR__?.(`Bootstrap failed:\n${msg}${err?.stack ? '\n\n' + err.stack : ''}`);
});
