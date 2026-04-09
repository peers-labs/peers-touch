import { type ReactNode, useEffect, useRef, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Users, AlertCircle } from 'lucide-react';
import { Tooltip, theme } from 'antd';
import { api } from '../services/desktop_api';
import { useOAuth2Store } from '../store/oauth2';
import { EVENT, eventBus } from '../kernel/events';

const HEARTBEAT_INTERVAL = 60_000;
const AUTH_CHECK_INTERVAL = 120_000;

interface GlobalLayoutProps {
  sideNav: ReactNode;
  children: ReactNode;
}

export function OnlineIndicator() {
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

export function AuthStatusIndicator() {
  const connections = useOAuth2Store((s) => s.connections);
  const loading = useOAuth2Store((s) => s.loading);
  const loadAll = useOAuth2Store((s) => s.loadAll);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    loadAll();
    timerRef.current = setInterval(loadAll, AUTH_CHECK_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
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

  const navigateToAccount = () => {
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'settings', id: 'account' });
  };

  return (
    <>
      <style>{pulseKeyframes}</style>
      <Tooltip title="No accounts authorized — click to open Account settings">
        <Flexbox
          align="center"
          justify="center"
          onClick={navigateToAccount}
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
  return (
    <Flexbox style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <Flexbox horizontal flex={1} style={{ overflow: 'hidden' }}>
        {sideNav}
        <Flexbox flex={1} style={{ overflow: 'hidden', position: 'relative' }}>
          {children}
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
}
