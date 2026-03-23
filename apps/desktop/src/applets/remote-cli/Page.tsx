import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { theme, Button, message, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  ArrowLeft,
  Pin,
  Plug,
  Terminal as TerminalIcon,
  Plus,
  X,
  Bot,
  Server,
  Settings,
  ChevronDown,
} from 'lucide-react';
import { api } from '../../services/api';
import { TerminalPanel, type TerminalHandle } from './Terminal';
import { BuilderPanel } from '../../components/BuilderPanel';
import { ConnectDialog } from './ConnectDialog';
import { ServerManager } from './ServerManager';
import type { Connection, SessionInfo } from './types';

interface Props {
  onBack: () => void;
  onPin?: () => void;
  pinned?: boolean;
}

interface Tab {
  id: string;
  session: SessionInfo;
  title: string;
  recovered?: boolean;
}

let tabCounter = 0;

export function RemoteCLIPage({ onBack, onPin, pinned }: Props) {
  const { token } = theme.useToken();

  const [connections, setConnections] = useState<Connection[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [showAgent, setShowAgent] = useState(true);

  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  // Dialog states
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [connectDialogMode, setConnectDialogMode] = useState<'connect' | 'edit' | 'add'>('connect');
  const [connectDialogConn, setConnectDialogConn] = useState<Connection | null>(null);
  const [serverManagerOpen, setServerManagerOpen] = useState(false);

  const termRefs = useRef<Map<string, TerminalHandle>>(new Map());

  const activeTab = useMemo(() => tabs.find((t) => t.id === activeTabId), [tabs, activeTabId]);

  const loadConnections = useCallback(async () => {
    try {
      const data = await api.appletAction<{ connections: Connection[] }>(
        'remote-cli',
        'list-connections',
      );
      setConnections(data.connections || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadConnections();

    (async () => {
      try {
        const data = await api.appletAction<{ sessions: SessionInfo[] }>(
          'remote-cli',
          'list-sessions',
        );
        const sessions = data.sessions || [];
        if (sessions.length > 0) {
          const recovered: Tab[] = sessions.map((s) => {
            tabCounter++;
            return {
              id: `tab-${tabCounter}`,
              session: s,
              title: s.connection_name || `Tab ${tabCounter}`,
              recovered: true,
            };
          });
          setTabs(recovered);
          setActiveTabId(recovered[0].id);
        }
      } catch {
        // no active sessions
      }
    })();
  }, [loadConnections]);

  const createNewTab = useCallback(async (connId: string, passphrase?: string) => {
    const params: Record<string, unknown> = { connection_id: connId };
    if (passphrase) params.passphrase = passphrase;

    const data = await api.appletAction<{ session: SessionInfo }>(
      'remote-cli',
      'create-session',
      params,
    );
    tabCounter++;
    const tab: Tab = {
      id: `tab-${tabCounter}`,
      session: data.session,
      title: data.session.connection_name || `Tab ${tabCounter}`,
    };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    return tab;
  }, []);

  // Called from ConnectDialog or quick-connect
  const handleConnect = useCallback(
    async (connId: string, passphrase?: string) => {
      setConnecting(true);
      try {
        await createNewTab(connId, passphrase);
        message.success('Connected');
      } finally {
        setConnecting(false);
      }
    },
    [createNewTab],
  );

  // Save a new or edited connection
  const handleSaveConnection = useCallback(
    async (connData: Partial<Connection> & { secret?: string }): Promise<Connection> => {
      if (connData.id) {
        await api.appletAction('remote-cli', 'update-connection', {
          id: connData.id,
          name: connData.name,
          host: connData.host,
          port: connData.port,
          username: connData.username,
          auth_type: connData.auth_type,
          key_path: connData.key_path,
          secret: connData.secret,
        });
        await loadConnections();
        return connData as Connection;
      }
      const result = await api.appletAction<{ connection: Connection }>(
        'remote-cli',
        'add-connection',
        {
          name: connData.name,
          host: connData.host,
          port: connData.port || 22,
          username: connData.username,
          auth_type: connData.auth_type || 'key_file',
          key_path: connData.key_path,
          secret: connData.secret,
        },
      );
      await loadConnections();
      return result.connection;
    },
    [loadConnections],
  );

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      try {
        await api.appletAction('remote-cli', 'close-session', {
          session_id: tab.session.id,
        });
      } catch {
        // ignore
      }
      termRefs.current.delete(tabId);
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tabId);
        setActiveTabId((currentActive) => {
          if (currentActive === tabId) {
            return next.length > 0 ? next[next.length - 1].id : null;
          }
          return currentActive;
        });
        return next;
      });
    },
    [tabs],
  );

  const handleWsDisconnectRef = useRef<(tabId: string) => void>(undefined);
  handleWsDisconnectRef.current = (tabId: string) => {
    termRefs.current.delete(tabId);
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      setActiveTabId((currentActive) => {
        if (currentActive === tabId) {
          return next.length > 0 ? next[next.length - 1].id : null;
        }
        return currentActive;
      });
      return next;
    });
  };

  const handleTerminalConnected = useCallback(
    async (tabId: string, cols: number, rows: number) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;
      try {
        await api.appletAction('remote-cli', 'resize', {
          session_id: tab.session.id,
          cols,
          rows,
        });
      } catch {
        // ignore
      }
    },
    [tabs],
  );

  // Build dropdown menu items for server connect
  const serverMenuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = [];

    if (connections.length > 0) {
      items.push({
        key: 'header-saved',
        type: 'group',
        label: 'Saved Connections',
        children: connections.map((c) => ({
          key: `conn-${c.id}`,
          icon: <Server size={14} />,
          label: (
            <Flexbox horizontal align="center" gap={6} style={{ width: '100%' }}>
              <span style={{ flex: 1 }}>{c.name}</span>
              <span style={{ fontSize: 11, opacity: 0.5, fontFamily: 'monospace' }}>
                {c.username}@{c.host}
              </span>
            </Flexbox>
          ),
          onClick: () => {
            const needsPrompt =
              c.auth_type === 'key_file' || c.auth_type === 'key' || c.auth_type === 'password';
            if (needsPrompt) {
              setConnectDialogConn(c);
              setConnectDialogMode('connect');
              setConnectDialogOpen(true);
            } else {
              handleConnect(c.id);
            }
          },
        })),
      });
    }

    items.push({ type: 'divider', key: 'div-actions' });
    items.push({
      key: 'add-new',
      icon: <Plus size={14} />,
      label: 'New Connection...',
      onClick: () => {
        setConnectDialogConn(null);
        setConnectDialogMode('add');
        setConnectDialogOpen(true);
      },
    });
    items.push({
      key: 'manage',
      icon: <Settings size={14} />,
      label: 'Manage Connections...',
      onClick: () => setServerManagerOpen(true),
    });

    return items;
  }, [connections, handleConnect]);

  const cliContextPayload = useMemo(() => {
    if (!activeTab) return {};
    return {
      cli_session_id: activeTab.session.id,
      connected_server: activeTab.session.connection_name || 'unknown',
    };
  }, [activeTab]);

  const hasTabs = tabs.length > 0;

  return (
    <Flexbox style={{ height: '100%', width: '100%' }}>
      {/* Header */}
      <Flexbox
        horizontal
        align="center"
        gap={10}
        style={{
          padding: '8px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
          background: token.colorBgContainer,
        }}
      >
        <ActionIcon icon={ArrowLeft} onClick={onBack} size="small" />
        <TerminalIcon size={18} color={token.colorPrimary} />
        <span style={{ fontWeight: 600, fontSize: 15 }}>Remote CLI</span>

        <div style={{ flex: 1 }} />

        {/* Server selector dropdown */}
        <Dropdown menu={{ items: serverMenuItems }} trigger={['click']} placement="bottomRight">
          <Button
            size="small"
            type={hasTabs ? 'default' : 'primary'}
            loading={connecting}
            icon={hasTabs ? <Plus size={14} /> : <Plug size={14} />}
          >
            {hasTabs ? 'New Tab' : 'Connect'}
            <ChevronDown size={12} style={{ marginLeft: 2 }} />
          </Button>
        </Dropdown>

        {onPin && (
          <ActionIcon
            icon={Pin}
            onClick={onPin}
            size="small"
            title={pinned ? 'Unpin from sidebar' : 'Pin to sidebar'}
            style={pinned ? { color: token.colorPrimary } : undefined}
          />
        )}
      </Flexbox>

      {/* Tab Bar */}
      {hasTabs && (
        <Flexbox
          horizontal
          align="center"
          style={{
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            flexShrink: 0,
            overflow: 'auto',
            gap: 0,
          }}
        >
          {tabs.map((tab) => (
            <Flexbox
              key={tab.id}
              horizontal
              align="center"
              gap={6}
              onClick={() => setActiveTabId(tab.id)}
              style={{
                padding: '6px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: tab.id === activeTabId ? 600 : 400,
                color: tab.id === activeTabId ? token.colorText : token.colorTextSecondary,
                borderBottom:
                  tab.id === activeTabId
                    ? `2px solid ${token.colorPrimary}`
                    : '2px solid transparent',
                background: tab.id === activeTabId ? token.colorBgContainer : 'transparent',
                transition: 'all 0.15s',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <TerminalIcon size={12} />
              <span>{tab.title}</span>
              <X
                size={12}
                style={{ opacity: 0.4, cursor: 'pointer', flexShrink: 0 }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleCloseTab(tab.id);
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as SVGElement).style.opacity = '1';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as SVGElement).style.opacity = '0.4';
                }}
              />
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {/* Body: Terminal + Agent Panel */}
      <Flexbox horizontal style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Terminal area */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              background: '#1a1a2e',
              position: 'relative',
              borderBottom: `2px solid ${token.colorBorderSecondary}`,
            }}
          >
            {hasTabs ? (
              tabs.map((tab) => (
                <div
                  key={tab.id}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    padding: 4,
                    display: tab.id === activeTabId ? 'block' : 'none',
                  }}
                >
                  <TerminalPanel
                    ref={(handle) => {
                      if (handle) termRefs.current.set(tab.id, handle);
                    }}
                    sessionId={tab.session.id}
                    onDisconnect={() => handleWsDisconnectRef.current?.(tab.id)}
                    onConnected={(cols, rows) => handleTerminalConnected(tab.id, cols, rows)}
                    isRecovered={tab.recovered}
                  />
                </div>
              ))
            ) : (
              <Flexbox
                align="center"
                justify="center"
                style={{
                  height: '100%',
                  color: 'rgba(255,255,255,0.3)',
                  fontSize: 14,
                  textAlign: 'center',
                  padding: 24,
                }}
              >
                <TerminalIcon
                  size={40}
                  strokeWidth={1.2}
                  style={{ marginBottom: 12, opacity: 0.4 }}
                />
                <div>No active session</div>
                <div style={{ fontSize: 12, marginTop: 4, opacity: 0.7 }}>
                  Click <strong>Connect</strong> to open a terminal to a remote server.
                </div>
              </Flexbox>
            )}
          </div>
        </div>

        {/* CLI Helper Panel OR expand button */}
        {showAgent ? (
          <BuilderPanel
            agentName="cli-helper"
            scope="remote_cli"
            welcomeTitle="CLI Helper"
            welcomeDescription="Ask about commands, troubleshooting, or terminal output analysis. I can execute commands and read terminal output."
            welcomeAvatar="💻"
            suggestQuestions={[
              "What's running on this server?",
              'Show disk usage',
              'Check system logs',
            ]}
            contextPayload={cliContextPayload}
            expand={showAgent}
            onExpandChange={setShowAgent}
            defaultWidth={380}
            minWidth={280}
            maxWidth={600}
            disabled={!hasTabs}
            disabledMessage="Connect to a server first to use CLI Helper"
          />
        ) : (
          <Flexbox
            align="center"
            justify="center"
            style={{
              width: 36,
              flexShrink: 0,
              background: token.colorBgContainer,
              borderLeft: `1px solid ${token.colorBorderSecondary}`,
              cursor: 'pointer',
            }}
            onClick={() => setShowAgent(true)}
            title="Show CLI Helper"
          >
            <Bot
              size={18}
              style={{
                color: token.colorTextSecondary,
                writingMode: 'vertical-rl',
              }}
            />
            <span
              style={{
                writingMode: 'vertical-rl',
                fontSize: 11,
                color: token.colorTextSecondary,
                marginTop: 8,
                letterSpacing: 1,
              }}
            >
              CLI Helper
            </span>
          </Flexbox>
        )}
      </Flexbox>

      {/* Connect Dialog */}
      <ConnectDialog
        open={connectDialogOpen}
        onClose={() => setConnectDialogOpen(false)}
        onConnect={handleConnect}
        onSave={handleSaveConnection}
        connection={connectDialogConn}
        mode={connectDialogMode}
      />

      {/* Server Manager Drawer */}
      <ServerManager
        open={serverManagerOpen}
        onClose={() => setServerManagerOpen(false)}
        connections={connections}
        onRefresh={loadConnections}
        onEdit={(conn) => {
          setServerManagerOpen(false);
          setConnectDialogConn(conn);
          setConnectDialogMode('edit');
          setConnectDialogOpen(true);
        }}
        onAdd={() => {
          setServerManagerOpen(false);
          setConnectDialogConn(null);
          setConnectDialogMode('add');
          setConnectDialogOpen(true);
        }}
        onConnect={(conn) => {
          setServerManagerOpen(false);
          const needsPrompt =
            conn.auth_type === 'key_file' || conn.auth_type === 'key' || conn.auth_type === 'password';
          if (needsPrompt) {
            setConnectDialogConn(conn);
            setConnectDialogMode('connect');
            setConnectDialogOpen(true);
          } else {
            handleConnect(conn.id);
          }
        }}
      />
    </Flexbox>
  );
}
