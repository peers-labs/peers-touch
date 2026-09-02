import { Component, type ErrorInfo, type ReactNode } from 'react';
import type { i18n as I18nInstance } from 'i18next';
import { log } from '../utils/logger';

interface Props {
  children: ReactNode;
  i18n: I18nInstance;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // #region debug-point A:react-component-stack
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'post-login-update-loop',
        runId: 'post-fix',
        hypothesisId: 'A',
        location: 'kernel/ErrorBoundary.tsx:componentDidCatch',
        msg: '[DEBUG] React render crash',
        data: {
          message: error.message,
          stack: error.stack,
          componentStack: info.componentStack,
          hash: window.location.hash,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
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
