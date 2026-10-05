import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, ToastHost } from '@lobehub/ui';
import { I18nextProvider } from 'react-i18next';
import { log } from './utils/logger';
import { initI18n } from './i18n';
import { ErrorBoundary } from './kernel/ErrorBoundary';
import { markPhaseEnd, markPhaseStart } from './kernel/boot';
import { purgeRetiredStorage } from './kernel/retiredStorage';
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

purgeRetiredStorage();
registerAppletElements();
installFrontendRuntimeProfiler();
configureFrontendTelemetryUploader(uploadFrontendTelemetryEvents);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    teardownFrontendRuntimeProfiler();
  });
}

async function installAcceptanceHarnessesForBuild(): Promise<void> {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;

  // #region debug-point E:harness-bootstrap
  void fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'marketplace-capability-session',
      runId: 'pre-fix',
      hypothesisId: 'E',
      location: 'apps/desktop/src/main.tsx:installAcceptanceHarnessesForBuild',
      msg: '[DEBUG] acceptance harness bootstrap started',
      data: {},
      ts: Date.now(),
    }),
  }).catch(() => {});
  // #endregion
  try {
    const [
      { installAcceptanceHarnesses },
      { installAgentAcceptanceHarness },
    ] = await Promise.all([
      import('./acceptance/registry'),
      import('./acceptance/agentAcceptanceHarness'),
    ]);
    // #region debug-point E:harness-modules
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'marketplace-capability-session',
        runId: 'pre-fix',
        hypothesisId: 'E',
        location: 'apps/desktop/src/main.tsx:installAcceptanceHarnessesForBuild',
        msg: '[DEBUG] acceptance harness modules loaded',
        data: {},
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    await installAcceptanceHarnesses();
    installAgentAcceptanceHarness();
    // #region debug-point E:harness-installed
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'marketplace-capability-session',
        runId: 'pre-fix',
        hypothesisId: 'E',
        location: 'apps/desktop/src/main.tsx:installAcceptanceHarnessesForBuild',
        msg: '[DEBUG] acceptance harnesses installed',
        data: {
          namespaces: Object.keys(window.__PT_ACCEPTANCE__ ?? {}).sort(),
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  } catch (error) {
    // #region debug-point E:harness-bootstrap-error
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'marketplace-capability-session',
        runId: 'pre-fix',
        hypothesisId: 'E',
        location: 'apps/desktop/src/main.tsx:installAcceptanceHarnessesForBuild',
        msg: '[DEBUG] acceptance harness bootstrap failed',
        data: {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack ?? '' : '',
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
    throw error;
  }
}

window.__PT_BOOT_STATUS__?.('Initializing…');

// ── Bootstrap (async: i18n → render) ──

async function bootstrap() {
  markPhaseStart('shell');

  await installAcceptanceHarnessesForBuild();

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
