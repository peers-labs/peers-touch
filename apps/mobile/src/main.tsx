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
}

class RootErrorBoundary extends Component<{ children: ReactNode }, RootErrorState> {
  state: RootErrorState = { error: null, source: 'render', componentStack: '' };

  private readonly onGlobalError = (event: ErrorEvent) => {
    this.setState({ error: normalizeError(event.error ?? event.message), source: 'global', componentStack: '' });
  };

  private readonly onUnhandledRejection = (event: PromiseRejectionEvent) => {
    this.setState({ error: normalizeError(event.reason), source: 'global', componentStack: '' });
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
              <button type="button" className="root-error-primary" onClick={() => window.location.reload()}>
                {mobileRootT('mobile.error.reload')}
              </button>
              {recovery.showSettings ? (
                <button type="button" className="root-error-secondary" onClick={openSystemSettings}>
                  {mobileRootT('mobile.error.openSettings')}
                </button>
              ) : null}
              {canDismiss ? (
                <button type="button" className="root-error-secondary" onClick={() => this.setState({ error: null, source: 'global', componentStack: '' })}>
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

function openSystemSettings() {
  window.location.assign('app-settings:');
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
