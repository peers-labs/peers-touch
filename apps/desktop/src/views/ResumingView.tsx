import { Spin, theme } from 'antd';
import { GlobalLayout } from '../components/GlobalLayout';
import type { AppLifecycle } from '../types/navigation';

interface ResumingViewProps {
  lifecycle: AppLifecycle;
}

// Gradient style matching OnboardingView branding.
const PEERS_GRADIENT_STYLE: React.CSSProperties = {
  fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontWeight: 800,
  fontSize: 40,
  letterSpacing: '-1px',
  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 40%, #f093fb 70%, #4facfe 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
};

/** Lightweight loading view shown during warm-resume session validation. */
export function ResumingView({ lifecycle: _lifecycle }: ResumingViewProps) {
  const { token } = theme.useToken();

  return (
    <GlobalLayout sideNav={null}>
      <div
        style={{
          width: '100%',
          height: '100%',
          background: token.colorBgLayout,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        <span style={PEERS_GRADIENT_STYLE}>Peers</span>
        <Spin />
      </div>
    </GlobalLayout>
  );
}
