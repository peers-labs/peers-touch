import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { toast } from '@lobehub/ui';
import { Typography, Spin, Empty, Button, Alert, theme } from 'antd';
import {
  Bot,
  ChartCandlestick,
  Download,
  NotebookPen,
  PackageOpen,
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

const OFFICIAL_IDENTITY: Record<string, { icon: ReactNode; label: string }> = {
  'peers.note': { icon: <NotebookPen size={31} strokeWidth={2.1} />, label: 'N' },
  'remote-cli': { icon: <TerminalSquare size={31} strokeWidth={2.1} />, label: 'CLI' },
  'web-search': { icon: <Search size={31} strokeWidth={2.1} />, label: 'S' },
  'agent-pilot': { icon: <Bot size={31} strokeWidth={2.1} />, label: 'AI' },
  'big-a': { icon: <ChartCandlestick size={31} strokeWidth={2.1} />, label: 'A' },
};

function errorMessage(error: unknown, fallback: string, t?: (key: string) => string): string {
  if (error instanceof Error && error.message.startsWith('error.applet.') && t) {
    return t(error.message);
  }
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
  const catalogApplets = useAppletsStore((state) => state.catalogApplets);
  const loading = useAppletsStore((state) => state.loading);
  const stationUnavailable = useAppletsStore((state) => state.stationUnavailable);
  const loadApplet = useAppletsStore((state) => state.loadApplet);
  const importAppletDirectory = useAppletsStore((state) => state.importAppletDirectory);
  const recentApplets = useMemo(
    () => applets
      .filter((info) => info.lastOpenedAt || info.status === 'active')
      .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0))
      .slice(0, 4),
    [applets],
  );
  const recentAppletIds = useMemo(
    () => new Set(recentApplets.map((info) => info.manifest.id)),
    [recentApplets],
  );
  const launcherApplets = useMemo(
    () => applets.filter((info) => !recentAppletIds.has(info.manifest.id)),
    [applets, recentAppletIds],
  );

  const handleOpen = useCallback(async (id: string) => {
    try {
      await loadApplet(id);
      onNavigate?.(`applet:${id}`);
    } catch (error) {
      toast.error(errorMessage(error, t('applet.toast.failedToActivate'), t));
    }
  }, [loadApplet, onNavigate, t]);

  const handleImport = useCallback(async () => {
    try {
      await importAppletDirectory();
      toast.success(t('applet.toast.imported'));
    } catch (error) {
      toast.error(errorMessage(error, t('applet.toast.importFailed')));
    }
  }, [importAppletDirectory, t]);

  if (loading) {
    return (
      <Flexbox
        align="center"
        justify="center"
        style={{
          height: '100%',
          background: token.colorBgLayout,
        }}
      >
        <Spin size="large" />
      </Flexbox>
    );
  }

  const hasInstalledApplets = applets.length > 0;
  const hasCatalogApplets = catalogApplets.length > 0;

  return (
    <Flexbox
      style={{
        height: '100%',
        overflow: 'auto',
        background: token.colorBgLayout,
      }}
    >
      <PageHeader
        title={t('applet.page.title')}
        subtitle={t('applet.page.subtitle')}
        icon={<Sparkles size={20} />}
      />

      <Flexbox gap={32} style={{ padding: '32px 56px 56px', maxWidth: 1080, width: '100%', margin: '0 auto' }}>
        <Flexbox
          horizontal
          align="flex-end"
          justify="space-between"
          gap={24}
          style={{
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            paddingBottom: 28,
          }}
        >
          <Flexbox gap={10} style={{ maxWidth: 640 }}>
            <Text
              type="secondary"
              style={{
                fontSize: 12,
                lineHeight: '16px',
                letterSpacing: 1.6,
                textTransform: 'uppercase',
              }}
            >
              {t('applet.page.launcherEyebrow')}
            </Text>
            <Text strong style={{ fontSize: 34, lineHeight: '40px', letterSpacing: -1 }}>
              {t('applet.page.launcherTitle')}
            </Text>
            <Text type="secondary" style={{ fontSize: 14, lineHeight: '22px' }}>
              {t('applet.page.launcherDescription')}
            </Text>
          </Flexbox>
          <Button icon={<Download size={15} />} onClick={handleImport}>
            {t('applet.page.importDirectory')}
          </Button>
        </Flexbox>

        {stationUnavailable && (
          <Alert
            type="warning"
            showIcon
            title={t('applet.page.stationUnavailableTitle')}
            description={t('applet.page.stationUnavailableDescription')}
          />
        )}

        {!hasInstalledApplets && !hasCatalogApplets ? (
          <LauncherEmptyState onImport={handleImport} />
        ) : (
          <>
            {recentApplets.length > 0 && (
              <AppletSection
                title={t('applet.page.recent')}
                applets={recentApplets}
                onOpen={handleOpen}
                actionLabel={t('applet.card.open')}
              />
            )}
            {(launcherApplets.length > 0 || recentApplets.length === 0) && (
              <AppletSection
                title={t('applet.page.mine')}
                description={t('applet.page.mineDescription')}
                applets={launcherApplets}
                onOpen={handleOpen}
                actionLabel={t('applet.card.open')}
                emptyDescription={hasInstalledApplets ? undefined : t('applet.page.empty')}
              />
            )}
            {hasCatalogApplets && (
              <AppletSection
                title={t('applet.page.box')}
                description={t('applet.page.boxDescription')}
                applets={catalogApplets}
                onOpen={handleOpen}
                actionLabel={t('applet.card.addAndOpen')}
                emptyDescription={t('applet.page.boxEmpty')}
                variant="available"
              />
            )}
          </>
        )}
      </Flexbox>
    </Flexbox>
  );
}

function AppletSection({
  title,
  description,
  applets,
  onOpen,
  actionLabel,
  emptyDescription,
  variant = 'installed',
}: {
  title: string;
  description?: string;
  applets: RuntimeAppletInfo[];
  onOpen: (id: string) => void;
  actionLabel: string;
  emptyDescription?: string;
  variant?: 'installed' | 'available';
}) {
  const { token } = theme.useToken();

  return (
    <Flexbox
      gap={18}
      style={{
        paddingTop: 2,
      }}
    >
      <Flexbox gap={4}>
        <Text strong style={{ fontSize: 15, letterSpacing: -0.2 }}>{title}</Text>
        {description && (
          <Text type="secondary" style={{ fontSize: 13, lineHeight: '20px' }}>
            {description}
          </Text>
        )}
      </Flexbox>
      {applets.length === 0 ? (
        <Flexbox
          align="center"
          justify="center"
          style={{
            minHeight: 168,
            borderRadius: 24,
            border: `1px dashed ${token.colorBorder}`,
            background: token.colorBgContainer,
          }}
        >
          <Empty image={<PackageOpen size={36} />} description={emptyDescription} />
        </Flexbox>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
            gap: '26px 20px',
          }}
        >
          {applets.map((info) => (
            <AppletIconTile
              key={info.manifest.id}
              info={info}
              onOpen={() => onOpen(info.manifest.id)}
              actionLabel={actionLabel}
              variant={variant}
            />
          ))}
        </div>
      )}
    </Flexbox>
  );
}

function AppletIconTile({
  info,
  onOpen,
  actionLabel,
  variant,
}: {
  info: RuntimeAppletInfo;
  onOpen: () => void;
  actionLabel: string;
  variant: 'installed' | 'available';
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('applet');
  const [iconAssetFailed, setIconAssetFailed] = useState(false);
  const identity = appletIdentity(info);
  const isActive = info.status === 'active';
  const isRevoked = info.status === 'revoked';
  const shouldUseAsset = Boolean(identity.assetUrl && !iconAssetFailed);
  const isAvailable = variant === 'available';

  return (
    <button
      type="button"
      data-applet-open={info.manifest.id}
      data-applet-status={info.status}
      data-applet-source={info.source}
      data-applet-opened-this-session={info.lastOpenedAt ? 'true' : 'false'}
      onClick={onOpen}
      disabled={isRevoked}
      style={{
        border: 0,
        background: 'transparent',
        borderRadius: 24,
        padding: '8px 6px 10px',
        cursor: isRevoked ? 'not-allowed' : 'pointer',
        opacity: isRevoked ? 0.56 : 1,
        minWidth: 0,
        outline: 'none',
        transition: 'transform 160ms ease, background 160ms ease',
      }}
      aria-label={`${actionLabel} ${info.manifest.name}`}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = token.colorFillQuaternary;
        if (!isRevoked) event.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
        event.currentTarget.style.transform = 'translateY(0)';
      }}
      onMouseDown={(event) => {
        if (!isRevoked) event.currentTarget.style.transform = 'translateY(0) scale(0.98)';
      }}
      onMouseUp={(event) => {
        if (!isRevoked) event.currentTarget.style.transform = 'translateY(-2px) scale(1)';
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
            width: 76,
            height: 76,
            borderRadius: 24,
            background: shouldUseAsset ? token.colorBgElevated : identity.background,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isActive
              ? `0 18px 34px ${identity.shadow}, 0 0 0 2px ${token.colorSuccessBorder}`
              : isAvailable
                ? `0 10px 24px ${token.colorFillSecondary}`
                : `0 16px 32px ${identity.shadow}`,
            position: 'relative',
            overflow: 'hidden',
            color: '#fff',
            filter: isAvailable ? 'saturate(0.82)' : undefined,
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
        {isAvailable && (
          <Text type="secondary" style={{ fontSize: 12, lineHeight: '16px' }}>
            {actionLabel}
          </Text>
        )}
      </Flexbox>
    </button>
  );
}

function LauncherEmptyState({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();

  return (
    <Flexbox
      align="center"
      justify="center"
      gap={18}
      style={{
        minHeight: 360,
        borderRadius: 28,
        border: `1px dashed ${token.colorBorder}`,
        background: token.colorBgContainer,
      }}
    >
      <div
        style={{
          width: 76,
          height: 76,
          borderRadius: 24,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: token.colorTextSecondary,
          background: token.colorFillQuaternary,
        }}
      >
        <PackageOpen size={34} />
      </div>
      <Flexbox align="center" gap={6} style={{ maxWidth: 360, textAlign: 'center' }}>
        <Text strong style={{ fontSize: 18, letterSpacing: -0.3 }}>
          {t('applet.page.emptyTitle')}
        </Text>
        <Text type="secondary" style={{ fontSize: 14, lineHeight: '22px' }}>
          {t('applet.page.empty')}
        </Text>
      </Flexbox>
      <Button icon={<Download size={15} />} onClick={onImport}>
        {t('applet.page.importDirectory')}
      </Button>
    </Flexbox>
  );
}
