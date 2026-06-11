import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Tag, Tooltip, toast } from '@lobehub/ui';
import { Typography, Spin, Badge, theme } from 'antd';
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
import { PageHeader } from '../components/PageHeader';
import { useAppletsStore, type RuntimeAppletInfo } from '../store/applets';

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

const CAP_LABELS: Record<string, { labelKey: string; icon: React.ReactNode }> = {
  search: { labelKey: 'applet.cap.search', icon: <Search size={11} /> },
  tools: { labelKey: 'applet.cap.tools', icon: <Wrench size={11} /> },
  help: { labelKey: 'applet.cap.help', icon: <HelpCircle size={11} /> },
  agents: { labelKey: 'applet.cap.agents', icon: <Bot size={11} /> },
  app: { labelKey: 'applet.cap.app', icon: <Blocks size={11} /> },
  lifecycle: { labelKey: 'applet.cap.lifecycle', icon: <Power size={11} /> },
  navigation: { labelKey: 'applet.cap.navigation', icon: <ChevronRight size={11} /> },
  ui: { labelKey: 'applet.cap.ui', icon: <Blocks size={11} /> },
  events: { labelKey: 'applet.cap.events', icon: <Sparkles size={11} /> },
  skills: { labelKey: 'applet.cap.skills', icon: <Wrench size={11} /> },
  tasks: { labelKey: 'applet.cap.tasks', icon: <Clock size={11} /> },
  agent: { labelKey: 'applet.cap.agent', icon: <Bot size={11} /> },
  ai: { labelKey: 'applet.cap.ai', icon: <Sparkles size={11} /> },
  telemetry: { labelKey: 'applet.cap.telemetry', icon: <Shield size={11} /> },
  storage: { labelKey: 'applet.cap.storage', icon: <Blocks size={11} /> },
  config: { labelKey: 'applet.cap.config', icon: <Wrench size={11} /> },
  system: { labelKey: 'applet.cap.system', icon: <Shield size={11} /> },
  device: { labelKey: 'applet.cap.device', icon: <Blocks size={11} /> },
  clipboard: { labelKey: 'applet.cap.clipboard', icon: <Blocks size={11} /> },
  file: { labelKey: 'applet.cap.file', icon: <Wrench size={11} /> },
  network: { labelKey: 'applet.cap.network', icon: <Wifi size={11} /> },
};

const PERMISSION_GROUP_LABELS: Record<string, { labelKey: string; color: string; icon: React.ReactNode }> = {
  network: { labelKey: 'applet.perm.network', color: 'blue', icon: <Wifi size={10} /> },
  app: { labelKey: 'applet.perm.app', color: 'default', icon: <Blocks size={10} /> },
  lifecycle: { labelKey: 'applet.perm.lifecycle', color: 'default', icon: <Power size={10} /> },
  navigation: { labelKey: 'applet.perm.navigation', color: 'geekblue', icon: <ChevronRight size={10} /> },
  ui: { labelKey: 'applet.perm.ui', color: 'cyan', icon: <Blocks size={10} /> },
  events: { labelKey: 'applet.perm.events', color: 'magenta', icon: <Sparkles size={10} /> },
  skills: { labelKey: 'applet.perm.skills', color: 'green', icon: <Wrench size={10} /> },
  tasks: { labelKey: 'applet.perm.tasks', color: 'lime', icon: <Clock size={10} /> },
  agent: { labelKey: 'applet.perm.agent', color: 'purple', icon: <Bot size={10} /> },
  ai: { labelKey: 'applet.perm.ai', color: 'purple', icon: <Sparkles size={10} /> },
  llm: { labelKey: 'applet.perm.llm', color: 'purple', icon: <Sparkles size={10} /> },
  telemetry: { labelKey: 'applet.perm.telemetry', color: 'gold', icon: <Shield size={10} /> },
  storage: { labelKey: 'applet.perm.storage', color: 'cyan', icon: <Blocks size={10} /> },
  config: { labelKey: 'applet.perm.config', color: 'gold', icon: <Wrench size={10} /> },
  system: { labelKey: 'applet.perm.system', color: 'default', icon: <Shield size={10} /> },
  device: { labelKey: 'applet.perm.device', color: 'default', icon: <Blocks size={10} /> },
  clipboard: { labelKey: 'applet.perm.clipboard', color: 'default', icon: <Blocks size={10} /> },
  file: { labelKey: 'applet.perm.files', color: 'green', icon: <Wrench size={10} /> },
  shell: { labelKey: 'applet.perm.shell', color: 'red', icon: <Shield size={10} /> },
  database: { labelKey: 'applet.perm.db', color: 'cyan', icon: <Blocks size={10} /> },
  secrets: { labelKey: 'applet.perm.secrets', color: 'gold', icon: <Shield size={10} /> },
  unknown: { labelKey: 'applet.perm.unknown', color: 'default', icon: <Shield size={10} /> },
};

interface PermissionGroup {
  group: string;
  permissions: string[];
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AppletsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();
  const applets = useAppletsStore((state) => state.applets);
  const loading = useAppletsStore((state) => state.loading);
  const loadApplet = useAppletsStore((state) => state.loadApplet);
  const unloadApplet = useAppletsStore((state) => state.unloadApplet);

  const handleToggle = useCallback(async (id: string, currentStatus: string) => {
    try {
      if (currentStatus === 'active') {
        await unloadApplet(id);
        toast.success(t('applet.toast.deactivated'));
      } else {
        await loadApplet(id);
        toast.success(t('applet.toast.activated'));
      }
    } catch (error) {
      toast.error(errorMessage(error, t('applet.toast.operationFailed')));
    }
  }, [loadApplet, t, unloadApplet]);

  const handleOpen = useCallback(async (id: string) => {
    try {
      await loadApplet(id);
      onNavigate?.(`applet:${id}`);
    } catch (error) {
      toast.error(errorMessage(error, t('applet.toast.failedToActivate')));
    }
  }, [loadApplet, onNavigate, t]);

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
        title={t('applet.page.title')}
        subtitle={t('applet.page.subtitle')}
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
            onOpen={() => handleOpen(info.manifest.id)}
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
            <Text type="secondary">{t('applet.page.empty')}</Text>
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
  info: RuntimeAppletInfo;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();
  const { manifest, status } = info;
  const iconData = getAppletIcon(manifest.icon);
  const isActive = status === 'active';

  return (
    <div
      className="applet-card"
      data-applet-card={manifest.id}
      data-applet-status={status}
      data-applet-opened-this-session={info.lastOpenedAt ? 'true' : 'false'}
    >
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
                      {isActive ? t('applet.card.active') : t('applet.card.inactive')}
                    </Text>
                  }
                />
              </Flexbox>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('applet.card.by', { author: manifest.author })}
              </Text>
            </Flexbox>

            {/* Toggle button */}
            <Tooltip title={isActive ? t('applet.card.deactivate') : t('applet.card.activate')}>
              <button
                data-applet-toggle={manifest.id}
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
                  {t(capMeta.labelKey)}
                </Tag>
              );
            })}

            <div style={{ width: 1, height: 14, background: token.colorBorderSecondary, margin: '0 2px' }} />

            {permissionGroups(manifest.permissions ?? []).map((group) => {
              const permMeta = PERMISSION_GROUP_LABELS[group.group] ?? PERMISSION_GROUP_LABELS.unknown;
              return (
                <Tooltip key={group.group} title={group.permissions.join('\n')}>
                  <Tag
                    data-applet-permission-group={group.group}
                    data-applet-permissions={group.permissions.join(',')}
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
                    {permMeta.icon}
                    {t(permMeta.labelKey)}
                    {group.permissions.length > 1 ? ` (${group.permissions.length})` : ''}
                  </Tag>
                </Tooltip>
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
                {appletSessionLabel(info, t)}
              </Text>
            </Flexbox>

            <Flexbox
              data-applet-open={manifest.id}
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
              {t('applet.card.open')}
              <ChevronRight size={14} />
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </div>
    </div>
  );
}

function permissionGroups(permissions: string[]): PermissionGroup[] {
  const grouped = new Map<string, string[]>();
  for (const permission of permissions) {
    const group = permissionGroup(permission);
    grouped.set(group, [...(grouped.get(group) ?? []), permission]);
  }
  return Array.from(grouped.entries()).map(([group, groupPermissions]) => ({
    group,
    permissions: groupPermissions,
  }));
}

function permissionGroup(permission: string): string {
  const separator = permission.includes('.') ? '.' : ':';
  const group = permission.split(separator)[0];
  return group && PERMISSION_GROUP_LABELS[group] ? group : 'unknown';
}

function appletSessionLabel(
  info: RuntimeAppletInfo,
  t: (key: string) => string,
): string {
  if (info.status === 'active') return t('applet.card.runningThisSession');
  if (info.lastOpenedAt) return t('applet.card.openedThisSession');
  return t('applet.card.notOpenedThisSession');
}
