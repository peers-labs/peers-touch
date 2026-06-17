import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { toast } from '@lobehub/ui';
import { Typography, Spin, Empty, theme } from 'antd';
import {
  Blocks,
  Globe,
  Sparkles,
  Search,
  Wrench,
  Bot,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useAppletsStore, type RuntimeAppletInfo } from '../store/applets';

const { Text } = Typography;

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

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AppletsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();
  const applets = useAppletsStore((state) => state.applets);
  const loading = useAppletsStore((state) => state.loading);
  const loadApplet = useAppletsStore((state) => state.loadApplet);
  const recentApplets = useMemo(
    () => applets
      .filter((info) => info.lastOpenedAt || info.status === 'active')
      .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))
      .slice(0, 8),
    [applets],
  );

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
    <Flexbox style={{ height: '100%', overflow: 'auto', background: token.colorBgLayout }}>
      <PageHeader
        title={t('applet.page.title')}
        subtitle={t('applet.page.subtitle')}
        icon={<Blocks size={20} />}
      />

      <Flexbox gap={18} style={{ padding: '28px 48px 48px', maxWidth: 960, width: '100%', margin: '0 auto' }}>
        {applets.length === 0 ? (
          <Flexbox
            align="center"
            justify="center"
            style={{
              minHeight: 360,
              borderRadius: 24,
              background: token.colorBgContainer,
            }}
          >
            <Empty description={t('applet.page.empty')} />
          </Flexbox>
        ) : (
          <>
            {recentApplets.length > 0 && (
              <AppletSection
                title={t('applet.page.recent')}
                applets={recentApplets}
                onOpen={handleOpen}
              />
            )}
            <AppletSection
              title={t('applet.page.mine')}
              action={t('applet.page.manage')}
              applets={applets}
              onOpen={handleOpen}
            />
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
}

function AppletSection({
  title,
  action,
  applets,
  onOpen,
}: {
  title: string;
  action?: string;
  applets: RuntimeAppletInfo[];
  onOpen: (id: string) => void;
}) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={18}
      style={{
        borderRadius: 24,
        background: token.colorBgContainer,
        padding: '18px 22px 20px',
        boxShadow: token.boxShadowTertiary,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between">
        <Text strong style={{ fontSize: 14 }}>{title}</Text>
        {action && <Text type="secondary" style={{ fontSize: 12 }}>{action}</Text>}
      </Flexbox>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(86px, 1fr))',
          gap: '18px 16px',
        }}
      >
        {applets.map((info) => (
          <AppletIconTile
            key={info.manifest.id}
            info={info}
            onOpen={() => onOpen(info.manifest.id)}
          />
        ))}
      </div>
    </Flexbox>
  );
}

function AppletIconTile({
  info,
  onOpen,
}: {
  info: RuntimeAppletInfo;
  onOpen: () => void;
}) {
  const { token } = theme.useToken();
  const iconData = getAppletIcon(info.manifest.icon);
  const isActive = info.status === 'active';

  return (
    <button
      data-applet-open={info.manifest.id}
      data-applet-status={info.status}
      data-applet-opened-this-session={info.lastOpenedAt ? 'true' : 'false'}
      onClick={onOpen}
      style={{
        border: 0,
        background: 'transparent',
        padding: 0,
        cursor: 'pointer',
        minWidth: 0,
      }}
      aria-label={info.manifest.name}
    >
      <Flexbox align="center" gap={8} style={{ minWidth: 0 }}>
        <div
          style={{
            width: 58,
            height: 58,
            borderRadius: 18,
            background: iconData.gradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isActive ? `0 10px 24px ${token.colorPrimaryBgHover}` : token.boxShadowSecondary,
            position: 'relative',
          }}
        >
          {iconData.icon}
          {isActive && (
            <span
              style={{
                position: 'absolute',
                right: -2,
                top: -2,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: token.colorSuccess,
                border: `2px solid ${token.colorBgContainer}`,
              }}
            />
          )}
        </div>
        <Text
          ellipsis
          style={{
            width: '100%',
            maxWidth: 86,
            fontSize: 13,
            lineHeight: '18px',
            textAlign: 'center',
            color: token.colorText,
          }}
        >
          {info.manifest.name}
        </Text>
      </Flexbox>
    </button>
  );
}
