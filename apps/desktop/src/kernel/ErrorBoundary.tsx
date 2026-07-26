import { Component, type ReactNode } from 'react';
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
