import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { toast } from '@lobehub/ui';
import { Typography, Spin, Empty, theme } from 'antd';
import {
  Bot,
  ChartCandlestick,
  NotebookPen,
  Search,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { PageHeader } from '../components/PageHeader';
import { useAppletsStore, type RuntimeAppletInfo } from '../store/applets';

const { Text } = Typography;

const IDENTITY_PALETTES = [
  { background: 'linear-gradient(145deg, #0f766e, #14b8a6)', shadow: 'rgba(20, 184, 166, 0.26)' },
  { background: 'linear-gradient(145deg, #1d4ed8, #60a5fa)', shadow: 'rgba(59, 130, 246, 0.26)' },
  { background: 'linear-gradient(145deg, #7c3aed, #c084fc)', shadow: 'rgba(168, 85, 247, 0.26)' },
  { background: 'linear-gradient(145deg, #be123c, #fb7185)', shadow: 'rgba(244, 63, 94, 0.24)' },
  { background: 'linear-gradient(145deg, #b45309, #fbbf24)', shadow: 'rgba(245, 158, 11, 0.24)' },
  { background: 'linear-gradient(145deg, #047857, #86efac)', shadow: 'rgba(34, 197, 94, 0.22)' },
  { background: 'linear-gradient(145deg, #334155, #94a3b8)', shadow: 'rgba(100, 116, 139, 0.22)' },
  { background: 'linear-gradient(145deg, #9333ea, #f472b6)', shadow: 'rgba(217, 70, 239, 0.22)' },
] as const;

const OFFICIAL_IDENTITY: Record<string, { icon: React.ReactNode; label: string }> = {
  'peers.note': { icon: <NotebookPen size={31} strokeWidth={2.1} />, label: 'N' },
  'remote-cli': { icon: <TerminalSquare size={31} strokeWidth={2.1} />, label: 'CLI' },
  'web-search': { icon: <Search size={31} strokeWidth={2.1} />, label: 'S' },
  'agent-pilot': { icon: <Bot size={31} strokeWidth={2.1} />, label: 'AI' },
  'big-a': { icon: <ChartCandlestick size={31} strokeWidth={2.1} />, label: 'A' },
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function stableHash(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function identityLabel(name: string, id: string): string {
  const words = name
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (words.length >= 2) return words.slice(0, 2).map((word) => word[0]).join('').toUpperCase();
  const source = words[0] || id;
  return Array.from(source).slice(0, 2).join('').toUpperCase();
}

function resolveIconAsset(info: RuntimeAppletInfo): string | undefined {
  const icon = info.manifest.icon?.trim();
  if (!icon) return undefined;
  if (/^(https?:|data:|asset:|\/)/.test(icon)) return icon;
  if (icon.includes('..')) return undefined;
  return `${info.manifest.path}/${icon}`;
}

function appletIdentity(info: RuntimeAppletInfo) {
  const id = info.manifest.id;
  const palette = IDENTITY_PALETTES[stableHash(id) % IDENTITY_PALETTES.length];
  const official = OFFICIAL_IDENTITY[id];
  return {
    ...palette,
    icon: official?.icon,
    label: official?.label || identityLabel(info.manifest.name, id),
    assetUrl: resolveIconAsset(info),
  };
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
    <Flexbox
      style={{
        height: '100%',
        overflow: 'auto',
        background: `
          radial-gradient(circle at 18% 8%, ${token.colorPrimaryBg} 0, transparent 32%),
          radial-gradient(circle at 86% 18%, ${token.colorInfoBg} 0, transparent 28%),
          linear-gradient(180deg, ${token.colorBgLayout}, ${token.colorBgContainer})
        `,
      }}
    >
      <PageHeader
        title={t('applet.page.title')}
        subtitle={t('applet.page.subtitle')}
        icon={<Sparkles size={20} />}
      />

      <Flexbox gap={28} style={{ padding: '32px 56px 56px', maxWidth: 1120, width: '100%', margin: '0 auto' }}>
        <Flexbox gap={8} style={{ maxWidth: 620 }}>
          <Text strong style={{ fontSize: 28, lineHeight: '34px', letterSpacing: -0.6 }}>
            {t('applet.page.launcherTitle')}
          </Text>
          <Text type="secondary" style={{ fontSize: 14, lineHeight: '22px' }}>
            {t('applet.page.launcherDescription')}
          </Text>
        </Flexbox>

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
  applets,
  onOpen,
}: {
  title: string;
  applets: RuntimeAppletInfo[];
  onOpen: (id: string) => void;
}) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={20}
      style={{
        borderRadius: 30,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        padding: '22px 26px 26px',
        boxShadow: token.boxShadowSecondary,
      }}
    >
      <Flexbox horizontal align="center" justify="space-between">
        <Text strong style={{ fontSize: 15, letterSpacing: -0.2 }}>{title}</Text>
      </Flexbox>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
          gap: '24px 18px',
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
  const { t } = useTranslation('applet');
  const [iconAssetFailed, setIconAssetFailed] = useState(false);
  const identity = appletIdentity(info);
  const isActive = info.status === 'active';
  const shouldUseAsset = Boolean(identity.assetUrl && !iconAssetFailed);

  return (
    <button
      type="button"
      data-applet-open={info.manifest.id}
      data-applet-status={info.status}
      data-applet-opened-this-session={info.lastOpenedAt ? 'true' : 'false'}
      onClick={onOpen}
      style={{
        border: 0,
        background: 'transparent',
        borderRadius: 24,
        padding: '10px 6px',
        cursor: 'pointer',
        minWidth: 0,
        outline: 'none',
        transition: 'transform 160ms ease, background 160ms ease',
      }}
      aria-label={info.manifest.name}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = token.colorFillQuaternary;
        event.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
        event.currentTarget.style.transform = 'translateY(0)';
      }}
      onMouseDown={(event) => {
        event.currentTarget.style.transform = 'translateY(0) scale(0.98)';
      }}
      onMouseUp={(event) => {
        event.currentTarget.style.transform = 'translateY(-2px) scale(1)';
      }}
      onFocus={(event) => {
        event.currentTarget.style.background = token.colorFillQuaternary;
        event.currentTarget.style.boxShadow = `0 0 0 3px ${token.colorPrimaryBg}`;
      }}
      onBlur={(event) => {
        event.currentTarget.style.background = 'transparent';
        event.currentTarget.style.boxShadow = 'none';
        event.currentTarget.style.transform = 'translateY(0)';
      }}
    >
      <Flexbox align="center" gap={10} style={{ minWidth: 0 }}>
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 22,
            background: shouldUseAsset ? token.colorBgElevated : identity.background,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isActive
              ? `0 18px 34px ${identity.shadow}, 0 0 0 2px ${token.colorSuccessBorder}`
              : `0 16px 32px ${identity.shadow}`,
            position: 'relative',
            overflow: 'hidden',
            color: '#fff',
          }}
        >
          {shouldUseAsset ? (
            <img
              src={identity.assetUrl}
              alt=""
              draggable={false}
              onError={() => setIconAssetFailed(true)}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          ) : identity.icon ? (
            identity.icon
          ) : (
            <Text
              style={{
                color: '#fff',
                fontSize: identity.label.length > 1 ? 22 : 28,
                fontWeight: 700,
                letterSpacing: -0.8,
                lineHeight: 1,
              }}
            >
              {identity.label}
            </Text>
          )}
          {isActive && (
            <span
              aria-label={t('applet.card.runningThisSession')}
              style={{
                position: 'absolute',
                right: 6,
                top: 6,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: token.colorSuccess,
                border: `2px solid ${token.colorBgElevated}`,
              }}
            />
          )}
        </div>
        <Text
          style={{
            width: '100%',
            maxWidth: 96,
            fontSize: 13,
            lineHeight: '18px',
            textAlign: 'center',
            color: token.colorText,
            minHeight: 36,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
          }}
        >
          {info.manifest.name}
        </Text>
      </Flexbox>
    </button>
  );
}
