import { Component, type ReactNode } from 'react';
import { Translation } from 'react-i18next';
import { log } from '../utils/logger';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    log.error('app', 'React render crash', { error: error.message, stack: error.stack });
  }

  private handleRestart = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <Translation ns="errors">
          {(t) => (
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              height: '100vh', padding: 40, fontFamily: 'system-ui, -apple-system, sans-serif',
              background: '#fafafa', color: '#333',
            }}>
              <div style={{
                maxWidth: 520, width: '100%', padding: 32, borderRadius: 12,
                background: '#fff', boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>😵</div>
                <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 600, color: '#1a1a1a' }}>
                  {t('error.boundary.title')}
                </h2>
                <p style={{ margin: '0 0 20px', fontSize: 14, color: '#666', lineHeight: 1.5 }}>
                  {t('error.boundary.description')}
                </p>
                <button
                  onClick={this.handleRestart}
                  style={{
                    padding: '10px 24px', fontSize: 14, fontWeight: 500, cursor: 'pointer',
                    border: 'none', borderRadius: 8, color: '#fff', background: '#1677ff',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#4096ff'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = '#1677ff'; }}
                >
                  {t('error.boundary.restart')}
                </button>
                <details style={{ marginTop: 20, fontSize: 12, color: '#999' }}>
                  <summary style={{ cursor: 'pointer', marginBottom: 8 }}>{t('error.boundary.details')}</summary>
                  <pre style={{
                    padding: 12, borderRadius: 6, background: '#f5f5f5', overflow: 'auto',
                    maxHeight: 200, fontSize: 11, lineHeight: 1.4, color: '#c00',
                  }}>
                    {error.message}
                    {'\n\n'}
                    {error.stack}
                  </pre>
                </details>
              </div>
            </div>
          )}
        </Translation>
      );
    }
    return this.props.children;
  }
}
