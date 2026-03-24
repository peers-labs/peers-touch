import { type ReactNode, useEffect, useRef, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Users, AlertCircle } from 'lucide-react';
import { Tooltip, theme } from 'antd';
import { api } from '../services/desktop_api';
import { useOAuth2Store } from '../store/oauth2';

const HEARTBEAT_INTERVAL = 60_000;
const AUTH_CHECK_INTERVAL = 120_000;

interface GlobalLayoutProps {
  sideNav: ReactNode;
  children: ReactNode;
}

function OnlineIndicator() {
  const [count, setCount] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const { token } = theme.useToken();

  const sendHeartbeat = useCallback(async () => {
    try {
      const res = await api.visitorHeartbeat();
      setCount(res.online);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    sendHeartbeat();
    timerRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [sendHeartbeat]);

  if (count === null) return null;

  return (
    <Tooltip title={`${count} visitor${count !== 1 ? 's' : ''} online in the last 5 minutes`}>
      <Flexbox
        horizontal
        align="center"
        gap={6}
        style={{
          padding: '4px 12px',
          borderRadius: 16,
          background: token.colorFillQuaternary,
          fontSize: 13,
          color: token.colorTextSecondary,
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: '#52c41a',
            display: 'inline-block',
            boxShadow: '0 0 4px #52c41a',
          }}
        />
        <Users size={14} />
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      </Flexbox>
    </Tooltip>
  );
}

const pulseKeyframes = `
@keyframes auth-pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(255, 77, 79, 0.6);
  }
  50% {
    box-shadow: 0 0 8px 4px rgba(255, 77, 79, 0.15);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(255, 77, 79, 0);
  }
}
@keyframes auth-gradient {
  0% { color: #ff4d4f; }
  33% { color: #ff7a45; }
  66% { color: #ff4d4f; }
  100% { color: #cf1322; }
}
`;

function AuthStatusIndicator() {
  const { connections, loading, loadAll } = useOAuth2Store();
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    loadAll();
    timerRef.current = setInterval(loadAll, AUTH_CHECK_INTERVAL);
    const noop = () => {
      // Store already updated by whoever called loadAll. Do NOT call loadAll here —
      // it would cause a cascade (loadAll→event→loadAll→429).
    };
    window.addEventListener('oauth2-connections-changed', noop);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      window.removeEventListener('oauth2-connections-changed', noop);
    };
  }, [loadAll]);

  const hasAccounts = (() => {
    if (loading && (connections?.length ?? 0) === 0) return null;
    const valid = (connections || []).filter(c => {
      if (!c.user_id || c.user_id === 'unknown') return false;
      if (!c.connected_at) return false;
      const d = new Date(c.connected_at);
      if (isNaN(d.getTime()) || d.getFullYear() <= 2000) return false;
      return c.status === 'active';
    });
    return valid.length > 0;
  })();

  if (hasAccounts === null) return null;
  if (hasAccounts) return null;

  const navigateToOAuth = () => {
    const event = new CustomEvent('navigate-settings-tab', { detail: 'oauth' });
    window.dispatchEvent(event);
  };

  return (
    <>
      <style>{pulseKeyframes}</style>
      <Tooltip title="No accounts authorized — click to set up OAuth">
        <Flexbox
          align="center"
          justify="center"
          onClick={navigateToOAuth}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            cursor: 'pointer',
            animation: 'auth-pulse 2s ease-in-out infinite',
            background: `radial-gradient(circle, rgba(255,77,79,0.12) 0%, transparent 70%)`,
            transition: 'transform 0.2s',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.15)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1)';
          }}
        >
          <AlertCircle
            size={18}
            style={{
              animation: 'auth-gradient 3s ease-in-out infinite',
              filter: 'drop-shadow(0 0 3px rgba(255,77,79,0.4))',
            }}
          />
        </Flexbox>
      </Tooltip>
    </>
  );
}

export function GlobalLayout({ sideNav, children }: GlobalLayoutProps) {
  const { token } = theme.useToken();

  return (
    <Flexbox style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      {/* Top bar */}
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        style={{
          height: 40,
          minHeight: 40,
          padding: '0 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          zIndex: 10,
        }}
      >
        <Flexbox horizontal align="center" gap={8}>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: token.colorText,
              letterSpacing: 0.5,
            }}
          >
            Agent Box
          </span>
        </Flexbox>
        <Flexbox horizontal align="center" gap={12}>
          <AuthStatusIndicator />
          <OnlineIndicator />
        </Flexbox>
      </Flexbox>

      {/* Main area: sidebar + content + (right sidebar placeholder) */}
      <Flexbox horizontal flex={1} style={{ overflow: 'hidden' }}>
        {sideNav}
        <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }}>
          {children}
        </Flexbox>
      </Flexbox>

      {/* Bottom bar — hidden, placeholder retained */}
      <Flexbox
        horizontal
        align="center"
        justify="center"
        style={{
          height: 24,
          minHeight: 24,
          padding: '0 16px',
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          fontSize: 11,
          color: token.colorTextQuaternary,
          userSelect: 'none',
          display: 'none',
        }}
      >
        Agent Box
      </Flexbox>
    </Flexbox>
  );
}
