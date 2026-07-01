import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tag } from '@lobehub/ui';
import { theme } from 'antd';

export type LynxDebugLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LynxDebugEvent {
  appletId: string;
  data?: Record<string, unknown>;
  elapsedMs?: number;
  level: LynxDebugLevel;
  sessionId?: string;
  stage: string;
  timestamp: number;
}

interface LynxDebugPanelProps {
  appletId: string;
  events: LynxDebugEvent[];
  onClear: () => void;
}

export function createLynxDebugEvent(
  appletId: string,
  stage: string,
  options?: {
    data?: Record<string, unknown>;
    elapsedMs?: number;
    level?: LynxDebugLevel;
    sessionId?: string;
  },
): LynxDebugEvent {
  return {
    appletId,
    data: options?.data,
    elapsedMs: options?.elapsedMs,
    level: options?.level ?? 'info',
    sessionId: options?.sessionId,
    stage,
    timestamp: Date.now(),
  };
}

export function LynxDebugPanel({ appletId, events, onClear }: LynxDebugPanelProps) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();
  const [collapsed, setCollapsed] = useState(false);
  const latest = events.length > 0 ? events[events.length - 1] : undefined;
  const errorCount = useMemo(() => events.filter((event) => event.level === 'error').length, [events]);

  if (!import.meta.env.DEV) return null;

  return (
    <div
      style={{
        position: 'absolute',
        right: 20,
        bottom: 20,
        zIndex: 40,
        width: collapsed ? 260 : 460,
        maxHeight: collapsed ? 96 : 360,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 16,
        background: token.colorBgElevated,
        boxShadow: token.boxShadowSecondary,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderBottom: collapsed ? 'none' : `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: token.colorText, fontSize: 13, fontWeight: 700 }}>
            {t('applet.runtime.debug.title')}
          </div>
          <div style={{ color: token.colorTextSecondary, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {appletId} · {latest ? latest.stage : t('applet.runtime.debug.noEvents')}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tag>{events.length}</Tag>
          {errorCount > 0 && <Tag color="red">{errorCount}</Tag>}
          <Button size="small" onClick={() => setCollapsed((value) => !value)}>
            {collapsed ? t('applet.runtime.debug.expand') : t('applet.runtime.debug.collapse')}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 12px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Button size="small" onClick={onClear}>
              {t('applet.runtime.debug.clear')}
            </Button>
          </div>
          <div style={{ maxHeight: 270, overflow: 'auto', padding: '8px 12px' }}>
            {events.length === 0 ? (
              <div style={{ color: token.colorTextTertiary, fontSize: 12 }}>
                {t('applet.runtime.debug.noEvents')}
              </div>
            ) : (
              events.slice().reverse().map((event, index) => (
                <DebugEventRow key={`${event.timestamp}:${event.stage}:${index}`} event={event} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function DebugEventRow({ event }: { event: LynxDebugEvent }) {
  const { token } = theme.useToken();
  const color = event.level === 'error'
    ? token.colorError
    : event.level === 'warn'
      ? token.colorWarning
      : event.level === 'debug'
        ? token.colorTextTertiary
        : token.colorPrimary;
  const detail = event.data ? JSON.stringify(event.data) : '';

  return (
    <div style={{ borderBottom: `1px solid ${token.colorBorderSecondary}`, padding: '7px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color, fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{event.stage}</span>
        <span style={{ color: token.colorTextTertiary, fontFamily: 'monospace', fontSize: 11 }}>
          {event.elapsedMs != null ? `${Math.round(event.elapsedMs)}ms` : new Date(event.timestamp).toLocaleTimeString()}
        </span>
      </div>
      {detail && (
        <pre
          style={{
            margin: '5px 0 0',
            color: token.colorTextSecondary,
            fontFamily: 'monospace',
            fontSize: 11,
            lineHeight: '16px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {detail}
        </pre>
      )}
    </div>
  );
}
