import { useEffect, useState, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Typography, Tag, Spin, Badge, message, Tooltip } from 'antd';
import { theme } from 'antd';
import {
  Blocks,
  Globe,
  Clock,
  Shield,
  Wifi,
  Sparkles,
  Search,
  HelpCircle,
  Wrench,
  Bot,
  ChevronRight,
  Power,
  PowerOff,
} from 'lucide-react';
import { api } from '../services/desktop_api';
import { PageHeader } from '../components/PageHeader';
import type { AppletInfo } from '../services/desktop_api';

const { Text, Paragraph } = Typography;

const APPLET_ICON_MAP: Record<string, { icon: React.ReactNode; gradient: string }> = {
  Globe: {
    icon: <Globe size={28} color="#fff" />,
    gradient: 'linear-gradient(135deg, #0ea5e9, #2563eb)',
  },
  Bot: {
    icon: <Bot size={28} color="#fff" />,
    gradient: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
  },
  Search: {
    icon: <Search size={28} color="#fff" />,
    gradient: 'linear-gradient(135deg, #f59e0b, #d97706)',
  },
  Wrench: {
    icon: <Wrench size={28} color="#fff" />,
    gradient: 'linear-gradient(135deg, #10b981, #059669)',
  },
  Sparkles: {
    icon: <Sparkles size={28} color="#fff" />,
    gradient: 'linear-gradient(135deg, #ec4899, #db2777)',
  },
};

function getAppletIcon(name?: string) {
  const entry = APPLET_ICON_MAP[name || ''];
  if (entry) return entry;
  return {
    icon: <Blocks size={28} color="#fff" />,
    gradient: 'linear-gradient(135deg, #667eea, #764ba2)',
  };
}

const CAP_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  search: { label: 'Search', icon: <Search size={11} /> },
  tools: { label: 'Tools', icon: <Wrench size={11} /> },
  help: { label: 'Help', icon: <HelpCircle size={11} /> },
  agents: { label: 'Agents', icon: <Bot size={11} /> },
};

const PERM_LABELS: Record<string, { label: string; color: string }> = {
  network: { label: 'Network', color: 'blue' },
  llm: { label: 'LLM', color: 'purple' },
  'file:read': { label: 'Files', color: 'green' },
  'file:write': { label: 'Write', color: 'orange' },
  shell: { label: 'Shell', color: 'red' },
  database: { label: 'DB', color: 'cyan' },
  secrets: { label: 'Secrets', color: 'gold' },
};

import { hasPage } from '../applets/registry';

export function AppletsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const [applets, setApplets] = useState<AppletInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { token } = theme.useToken();

  const loadApplets = useCallback(async () => {
    try {
      const data = await api.listApplets();
      setApplets(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApplets();
  }, [loadApplets]);

  const handleToggle = useCallback(async (id: string, currentStatus: string) => {
    try {
      if (currentStatus === 'active') {
        await api.deactivateApplet(id);
        message.success('Applet deactivated');
      } else {
        await api.activateApplet(id);
        message.success('Applet activated');
      }
      loadApplets();
    } catch (e: any) {
      message.error(e.message || 'Operation failed');
    }
  }, [loadApplets]);

  const handleOpen = useCallback(async (id: string, currentStatus: string) => {
    if (currentStatus !== 'active') {
      try {
        await api.activateApplet(id);
        loadApplets();
      } catch (e: any) {
        message.error(e.message || 'Failed to activate');
        return;
      }
    }
    if (hasPage(id) && onNavigate) {
      onNavigate(`applet:${id}`);
    } else {
      message.info('This applet does not have a dedicated page yet');
    }
  }, [loadApplets, onNavigate]);

  if (loading) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%' }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  return (
    <Flexbox style={{ height: '100%', overflow: 'auto' }}>
      <PageHeader
        title="Agent Applets"
        subtitle="Extend Agent Box with pluggable applets — each is a self-contained agent with its own UI, tools, and knowledge."
        icon={<Blocks size={20} />}
      />

      {/* Card Grid */}
      <div
        style={{
          padding: '28px 40px 48px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
          gap: 20,
          alignContent: 'start',
        }}
      >
        {applets.map((info) => (
          <AppletCard
            key={info.manifest.id}
            info={info}
            onToggle={() => handleToggle(info.manifest.id, info.status)}
            onOpen={() => handleOpen(info.manifest.id, info.status)}
          />
        ))}

        {applets.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            gap={12}
            style={{
              gridColumn: '1 / -1',
              padding: 64,
              color: token.colorTextTertiary,
            }}
          >
            <Blocks size={48} strokeWidth={1} />
            <Text type="secondary">No applets installed yet.</Text>
          </Flexbox>
        )}
      </div>
    </Flexbox>
  );
}

function AppletCard({
  info,
  onToggle,
  onOpen,
}: {
  info: AppletInfo;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { token } = theme.useToken();
  const { manifest, status } = info;
  const iconData = getAppletIcon(manifest.icon);
  const isActive = status === 'active';

  return (
    <div className="applet-card">
      <div
        style={{
          borderRadius: 16,
          border: `1px solid ${isActive ? token.colorPrimaryBorder : token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          overflow: 'hidden',
          transition: 'all 0.25s ease',
          cursor: 'pointer',
          position: 'relative',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = token.colorPrimary;
          e.currentTarget.style.boxShadow = `0 4px 24px ${token.colorPrimaryBg}`;
          e.currentTarget.style.transform = 'translateY(-2px)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = isActive ? token.colorPrimaryBorder : token.colorBorderSecondary;
          e.currentTarget.style.boxShadow = 'none';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        {/* Top color accent bar */}
        <div
          style={{
            height: 3,
            background: isActive ? iconData.gradient : token.colorBorderSecondary,
            transition: 'background 0.3s',
          }}
        />

        <Flexbox style={{ padding: '20px 20px 16px' }} gap={14}>
          {/* Row 1: Icon + Name + Status + Toggle */}
          <Flexbox horizontal align="center" gap={14}>
            {/* Applet icon */}
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                background: iconData.gradient,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: isActive ? `0 4px 12px rgba(0,0,0,0.12)` : 'none',
                opacity: isActive ? 1 : 0.6,
                transition: 'opacity 0.2s, box-shadow 0.2s',
              }}
            >
              {iconData.icon}
            </div>

            <Flexbox flex={1} style={{ minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8}>
                <Text strong style={{ fontSize: 16, lineHeight: 1.3 }}>
                  {manifest.name}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  v{manifest.version}
                </Text>
                <Badge
                  status={isActive ? 'success' : 'default'}
                  text={
                    <Text
                      style={{
                        fontSize: 11,
                        color: isActive ? token.colorSuccess : token.colorTextQuaternary,
                      }}
                    >
                      {isActive ? 'Active' : 'Inactive'}
                    </Text>
                  }
                />
              </Flexbox>
              <Text type="secondary" style={{ fontSize: 12 }}>
                by {manifest.author}
              </Text>
            </Flexbox>

            {/* Toggle button */}
            <Tooltip title={isActive ? 'Deactivate' : 'Activate'}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: `1px solid ${isActive ? token.colorErrorBorder : token.colorSuccessBorder}`,
                  background: isActive ? token.colorErrorBg : token.colorSuccessBg,
                  color: isActive ? token.colorError : token.colorSuccess,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  transition: 'all 0.2s',
                }}
              >
                {isActive ? <PowerOff size={16} /> : <Power size={16} />}
              </button>
            </Tooltip>
          </Flexbox>

          {/* Row 2: Description */}
          <Paragraph
            type="secondary"
            style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}
            ellipsis={{ rows: 2 }}
          >
            {manifest.description}
          </Paragraph>

          {/* Row 3: Capabilities + Permissions */}
          <Flexbox horizontal align="center" gap={6} wrap="wrap">
            {manifest.capabilities?.map((cap) => {
              const capMeta = CAP_LABELS[cap];
              if (!capMeta) return null;
              return (
                <Tag
                  key={cap}
                  style={{
                    fontSize: 11,
                    lineHeight: '20px',
                    padding: '0 8px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    margin: 0,
                  }}
                >
                  {capMeta.icon}
                  {capMeta.label}
                </Tag>
              );
            })}

            <div style={{ width: 1, height: 14, background: token.colorBorderSecondary, margin: '0 2px' }} />

            {manifest.permissions?.map((perm) => {
              const permMeta = PERM_LABELS[perm];
              if (!permMeta) return null;
              return (
                <Tag
                  key={perm}
                  color={permMeta.color}
                  style={{
                    fontSize: 11,
                    lineHeight: '20px',
                    padding: '0 8px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    margin: 0,
                  }}
                >
                  {perm === 'network' ? <Wifi size={10} /> : <Shield size={10} />}
                  {permMeta.label}
                </Tag>
              );
            })}
          </Flexbox>

          {/* Row 4: Footer — Last used + Open */}
          <Flexbox
            horizontal
            align="center"
            justify="space-between"
            style={{
              paddingTop: 12,
              borderTop: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Flexbox horizontal align="center" gap={6}>
              <Clock size={12} style={{ color: token.colorTextQuaternary }} />
              <Text type="secondary" style={{ fontSize: 12 }}>
                Last used 2 hours ago
              </Text>
            </Flexbox>

            <Flexbox
              horizontal
              align="center"
              gap={4}
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: token.colorPrimary,
                cursor: 'pointer',
              }}
            >
              Open
              <ChevronRight size={14} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
}
