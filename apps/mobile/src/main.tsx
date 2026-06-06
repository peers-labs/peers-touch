import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';

import { App } from './App';
import { installMobileWebGuards } from './app/installMobileWebGuards';
import enCommon from '../../../packages/locales/en/common.json';
import zhCommon from '../../../packages/locales/zh-CN/common.json';
import './styles.css';

type TranslationParams = Record<string, string | number>;
type RootErrorSource = 'render' | 'global';

interface RootErrorState {
  error: Error | null;
  source: RootErrorSource;
  componentStack: string;
  diagnosticsCopied: boolean;
  diagnosticsCopyFailed: boolean;
}

class RootErrorBoundary extends Component<{ children: ReactNode }, RootErrorState> {
  state: RootErrorState = { error: null, source: 'render', componentStack: '', diagnosticsCopied: false, diagnosticsCopyFailed: false };

  private readonly onGlobalError = (event: ErrorEvent) => {
    if (isIgnorableGlobalError(event.error ?? event.message)) return;
    this.setState({ error: normalizeError(event.error ?? event.message), source: 'global', componentStack: '', diagnosticsCopied: false, diagnosticsCopyFailed: false });
  };

  private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => {
    if (isIgnorableGlobalError(event.reason)) return;
    this.setState({ error: normalizeError(event.reason), source: 'global', componentStack: '', diagnosticsCopied: false, diagnosticsCopyFailed: false });
  };

  static getDerivedStateFromError(error: Error) {
    return { error, source: 'render' };
  }

  componentDidMount() {
    window.addEventListener('error', this.onGlobalError);
    window.addEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener('error', this.onGlobalError);
    window.removeEventListener('unhandledrejection', this.onUnhandledRejection);
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  private readonly copyDiagnostics = async () => {
    if (!this.state.error) return;
    try {
      await copyTextToClipboard(formatRootErrorDiagnostics(this.state.error, this.state.source, this.state.componentStack));
      this.setState({ diagnosticsCopied: true, diagnosticsCopyFailed: false });
    } catch {
      this.setState({ diagnosticsCopied: false, diagnosticsCopyFailed: true });
    }
  };

  render() {
    if (this.state.error) {
      const recovery = describeRootError(this.state.error);
      const canDismiss = this.state.source === 'global';
      return (
        <div className="root-error-screen" role="alert">
          <div className="root-error-orb" aria-hidden="true" />
          <section className="root-error-card">
            <div className="root-error-eyebrow">{mobileRootT('mobile.error.eyebrow')}</div>
            <h1>{mobileRootT(recovery.titleKey)}</h1>
            <p>{mobileRootT(recovery.subtitleKey)}</p>
            <div className="root-error-message">
              <strong>{mobileRootT(recovery.summaryKey)}</strong>
              <span>{recovery.detail}</span>
              {this.state.componentStack ? (
                <details className="root-error-details">
                  <summary>{mobileRootT('mobile.error.technicalDetails')}</summary>
                  <pre>{this.state.componentStack}</pre>
                </details>
              ) : null}
            </div>
            <div className="root-error-actions">
              <button type="button" className="root-error-secondary root-error-copy" onClick={this.copyDiagnostics}>
                {mobileRootT(getCopyDiagnosticsLabelKey(this.state))}
              </button>
              <button type="button" className="root-error-primary" onClick={() => window.location.reload()}>
                {mobileRootT('mobile.error.reload')}
              </button>
              {recovery.showSettings ? (
                <button type="button" className="root-error-secondary" onClick={openSystemSettings}>
                  {mobileRootT('mobile.error.openSettings')}
                </button>
              ) : null}
              {canDismiss ? (
                <button type="button" className="root-error-secondary" onClick={() => this.setState({ error: null, source: 'global', componentStack: '', diagnosticsCopied: false, diagnosticsCopyFailed: false })}>
                  {mobileRootT('mobile.error.dismiss')}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      );
    }
    return this.props.children;
  }
}

installMobileWebGuards();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <RootErrorBoundary>
        <App />
      </RootErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  return new Error(mobileRootT('mobile.error.fallbackMessage'));
}

function isIgnorableGlobalError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /ResizeObserver loop (completed with undelivered notifications|limit exceeded)/i.test(message);
}

function openSystemSettings() {
  window.location.assign('app-settings:');
}

function getCopyDiagnosticsLabelKey(state: RootErrorState): string {
  if (state.diagnosticsCopyFailed) return 'mobile.error.copyDiagnosticsFailed';
  if (state.diagnosticsCopied) return 'mobile.error.copiedDiagnostics';
  return 'mobile.error.copyDiagnostics';
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function formatRootErrorDiagnostics(error: Error, source: RootErrorSource, componentStack: string): string {
  return [
    `Source: ${source}`,
    `Name: ${error.name || 'Error'}`,
    `Message: ${error.message || mobileRootT('mobile.error.fallbackMessage')}`,
    '',
    'Stack:',
    error.stack || mobileRootT('mobile.error.noStack'),
    '',
    'Component stack:',
    componentStack || mobileRootT('mobile.error.noComponentStack'),
  ].join('\n');
}

function describeRootError(error: Error): {
  titleKey: string;
  subtitleKey: string;
  summaryKey: string;
  detail: string;
  showSettings: boolean;
} {
  const message = error.message || mobileRootT('mobile.error.fallbackMessage');
  if (/local network|localhost|grant.*permission|settings\s*>\s*privacy/i.test(message)) {
    return {
      titleKey: 'mobile.error.networkPermissionTitle',
      subtitleKey: 'mobile.error.networkPermissionSubtitle',
      summaryKey: 'mobile.error.networkPermissionSummary',
      detail: message,
      showSettings: true,
    };
  }

  if (/maximum update depth/i.test(message)) {
    return {
      titleKey: 'mobile.error.renderLoopTitle',
      subtitleKey: 'mobile.error.renderLoopSubtitle',
      summaryKey: 'mobile.error.renderLoopSummary',
      detail: message,
      showSettings: false,
    };
  }

  return {
    titleKey: 'mobile.error.title',
    subtitleKey: 'mobile.error.subtitle',
    summaryKey: 'mobile.error.fallbackSummary',
    detail: message,
    showSettings: false,
  };
}

function mobileRootT(key: string, params?: TranslationParams): string {
  const resources = navigator.language.startsWith('zh') ? zhCommon : enCommon;
  const fallback = enCommon[key as keyof typeof enCommon] ?? key;
  const value = resources[key as keyof typeof resources] ?? fallback;
  if (!params) return value;
  return Object.entries(params).reduce((next, [paramKey, replacement]) => next.replaceAll(`{{${paramKey}}}`, String(replacement)), value);
}
