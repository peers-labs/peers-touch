import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider } from '@lobehub/ui';

import { App } from './App';
import { installMobileWebGuards } from './app/installMobileWebGuards';
import './styles.css';

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          <h2 style={{ color: '#e53e3e' }}>Runtime Error</h2>
          <p><strong>{this.state.error.message}</strong></p>
          <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, overflow: 'auto', maxHeight: '60vh' }}>
            {this.state.error.stack}
          </pre>
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
