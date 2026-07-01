import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { toast } from '@lobehub/ui';
import { Typography, Spin, Alert, theme } from 'antd';
import {
  Bot,
  ChartCandlestick,
  FileInput,
  NotebookPen,
  PackageOpen,
  Plus,
  Search,
  TerminalSquare,
} from 'lucide-react';
import { useAppletsStore, type RuntimeAppletInfo } from '../store/applets';

const { Text } = Typography;

// Identity tints stay low-saturation per Quiet Protocol Minimalism: a soft
// surface tint plus a readable foreground, never a high-saturation gradient.
const IDENTITY_TINTS = [
  { background: '#eef2ff', foreground: '#4f46e5' },
  { background: '#edf7ff', foreground: '#2563eb' },
  { background: '#f5f0ff', foreground: '#7c3aed' },
  { background: '#edf7f2', foreground: '#0f766e' },
  { background: '#fff3ed', foreground: '#c2410c' },
  { background: '#eef0f3', foreground: '#1f2937' },
  { background: '#f1f3f5', foreground: '#64748b' },
  { background: '#eef8f6', foreground: '#0f766e' },
] as const;

const OFFICIAL_IDENTITY: Record<string, { icon: ReactNode }> = {
  'peers.note': { icon: <NotebookPen size={30} strokeWidth={2} /> },
  'remote-cli': { icon: <TerminalSquare size={30} strokeWidth={2} /> },
  'web-search': { icon: <Search size={30} strokeWidth={2} /> },
  'agent-pilot': { icon: <Bot size={30} strokeWidth={2} /> },
  'big-a': { icon: <ChartCandlestick size={30} strokeWidth={2} /> },
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
  const tint = IDENTITY_TINTS[stableHash(id) % IDENTITY_TINTS.length];
  const official = OFFICIAL_IDENTITY[id];
  return {
    ...tint,
    icon: official?.icon,
    label: identityLabel(info.manifest.name, id),
    assetUrl: resolveIconAsset(info),
  };
}

export function AppletsPage({ onNavigate }: { onNavigate?: (page: string) => void }) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();
  const applets = useAppletsStore((state) => state.applets);
  const loading = useAppletsStore((state) => state.loading);
  const stationUnavailable = useAppletsStore((state) => state.stationUnavailable);
  const importAppletDirectory = useAppletsStore((state) => state.importAppletDirectory);

  const [query, setQuery] = useState('');
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [runningExpanded, setRunningExpanded] = useState(false);
  const importMenuRef = useRef<HTMLDivElement | null>(null);

  const visibleApplets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return applets
      .filter((info) => (normalized ? info.manifest.name.toLowerCase().includes(normalized) : true))
      .sort((left, right) => (right.lastOpenedAt ?? -1) - (left.lastOpenedAt ?? -1));
  }, [applets, query]);

  const runningApplets = useMemo(
    () => applets
      .filter((info) => info.status === 'active')
      .sort((left, right) => (right.lastOpenedAt ?? -1) - (left.lastOpenedAt ?? -1)),
    [applets],
  );

  const handleOpen = useCallback((id: string) => {
    onNavigate?.(`applet:${id}`);
  }, [onNavigate]);

  const handleImport = useCallback(async () => {
    setImportMenuOpen(false);
    try {
      await importAppletDirectory();
      toast.success(t('applet.toast.imported'));
    } catch (error) {
      toast.error(errorMessage(error, t('applet.toast.importFailed'), t));
    }
  }, [importAppletDirectory, t]);

  useEffect(() => {
    if (!importMenuOpen) return undefined;
    const handlePointerDown = (event: MouseEvent) => {
      if (!importMenuRef.current?.contains(event.target as Node)) {
        setImportMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [importMenuOpen]);

  if (loading && applets.length === 0) {
    return (
      <Flexbox align="center" justify="center" style={{ height: '100%', background: token.colorBgLayout }}>
        <Spin size="large" />
      </Flexbox>
    );
  }

  const hasApplets = applets.length > 0;

  return (
    <Flexbox
      style={{
        position: 'relative',
        height: '100%',
        overflow: 'hidden',
        padding: '22px 26px 24px',
        background: `linear-gradient(180deg, ${token.colorBgContainer}db, ${token.colorBgContainer}a3), ${token.colorBgLayout}`,
      }}
    >
      <Flexbox
        horizontal
        align="center"
        justify="space-between"
        gap={10}
        style={{ paddingBottom: 10, flexShrink: 0 }}
      >
        <label
          style={{
            height: 36,
            width: 'min(320px, calc(100% - 56px))',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 10px',
            borderRadius: token.borderRadius,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            color: token.colorTextTertiary,
          }}
        >
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('applet.page.searchPlaceholder')}
            style={{
              width: '100%',
              border: 0,
              outline: 'none',
              background: 'transparent',
              color: token.colorText,
              fontSize: 13,
            }}
          />
        </label>

        <div ref={importMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label={t('applet.page.importAction')}
            onClick={() => setImportMenuOpen((open) => !open)}
            style={{
              width: 40,
              height: 40,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 0,
              borderRadius: token.borderRadius,
              background: importMenuOpen ? token.colorFillTertiary : 'transparent',
              color: importMenuOpen ? token.colorText : token.colorTextSecondary,
              cursor: 'pointer',
              transition: 'background 160ms ease, color 160ms ease',
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = token.colorFillTertiary;
              event.currentTarget.style.color = token.colorText;
            }}
            onMouseLeave={(event) => {
              if (importMenuOpen) return;
              event.currentTarget.style.background = 'transparent';
              event.currentTarget.style.color = token.colorTextSecondary;
            }}
          >
            <Plus size={18} />
          </button>
          {importMenuOpen && (
            <div
              role="menu"
              style={{
                position: 'absolute',
                top: 46,
                right: 0,
                zIndex: 30,
                minWidth: 160,
                padding: 6,
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgElevated,
                boxShadow: token.boxShadowSecondary,
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={handleImport}
                style={{
                  width: '100%',
                  height: 34,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 10px',
                  border: 0,
                  borderRadius: token.borderRadius,
                  background: 'transparent',
                  color: token.colorText,
                  textAlign: 'left',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = token.colorFillTertiary;
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = 'transparent';
                }}
              >
                <FileInput size={15} />
                {t('applet.page.importPackage')}
              </button>
            </div>
          )}
        </div>
      </Flexbox>

      {stationUnavailable && (
        <div style={{ padding: '0 0 4px', flexShrink: 0 }}>
          <Alert
            type="warning"
            showIcon
            message={t('applet.page.stationUnavailableTitle')}
            description={t('applet.page.stationUnavailableDescription')}
          />
        </div>
      )}

      {hasApplets ? (
        <section
          aria-label={t('applet.page.mine')}
          style={{
            flex: '0 0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
            alignContent: 'start',
            gap: '22px 34px',
            maxHeight: 196,
            padding: '24px 28px 0',
            overflow: 'auto',
          }}
        >
          {visibleApplets.map((info) => (
            <AppletIconTile
              key={info.manifest.id}
              info={info}
              onOpen={() => handleOpen(info.manifest.id)}
            />
          ))}
        </section>
      ) : (
        <LauncherEmptyState onImport={handleImport} />
      )}

      {runningApplets.length > 0 && (
        <RunningSwitcher
          applets={runningApplets}
          expanded={runningExpanded}
          onToggle={() => setRunningExpanded((expanded) => !expanded)}
          onOpen={handleOpen}
        />
      )}
    </Flexbox>
  );
}

function AppletIconTile({ info, onOpen }: { info: RuntimeAppletInfo; onOpen: () => void }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('applet');
  const [iconAssetFailed, setIconAssetFailed] = useState(false);
  const identity = appletIdentity(info);
  const isActive = info.status === 'active';
  const isRevoked = info.status === 'revoked';
  const shouldUseAsset = Boolean(identity.assetUrl && !iconAssetFailed);

  return (
    <button
      type="button"
      data-applet-open={info.manifest.id}
      data-applet-status={info.status}
      onClick={onOpen}
      disabled={isRevoked}
      aria-label={`${t('applet.card.open')} ${info.manifest.name}`}
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 9,
        padding: '8px 6px 10px',
        border: 0,
        borderRadius: token.borderRadiusLG,
        background: 'transparent',
        cursor: isRevoked ? 'not-allowed' : 'pointer',
        opacity: isRevoked ? 0.56 : 1,
        transition: 'background 160ms ease',
      }}
      onMouseEnter={(event) => {
        if (!isRevoked) event.currentTarget.style.background = token.colorFillQuaternary;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = 'transparent';
      }}
    >
      <div
        style={{
          position: 'relative',
          width: 82,
          height: 82,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 24,
          background: shouldUseAsset ? token.colorBgContainer : identity.background,
          color: identity.foreground,
          boxShadow: `inset 0 0 0 1px ${token.colorBorderSecondary}`,
          overflow: 'hidden',
        }}
      >
        {shouldUseAsset ? (
          <img
            src={identity.assetUrl}
            alt=""
            draggable={false}
            onError={() => setIconAssetFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : identity.icon ? (
          identity.icon
        ) : (
          <Text style={{ color: identity.foreground, fontSize: 26, fontWeight: 600, lineHeight: 1 }}>
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
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: token.colorSuccess,
              border: `2px solid ${token.colorBgContainer}`,
            }}
          />
        )}
      </div>
      <Text
        style={{
          maxWidth: 100,
          fontSize: 14,
          lineHeight: '18px',
          textAlign: 'center',
          color: token.colorText,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}
      >
        {info.manifest.name}
      </Text>
    </button>
  );
}

function RunningSwitcher({
  applets,
  expanded,
  onToggle,
  onOpen,
}: {
  applets: RuntimeAppletInfo[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('applet');
  const total = applets.length;

  return (
    <section
      aria-label={t('applet.page.running')}
      style={{
        position: 'relative',
        zIndex: 12,
        flex: 1,
        minHeight: 'clamp(220px, 38vh, 360px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 10,
        padding: '12px 26px clamp(34px, 6vh, 64px)',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: expanded ? 'min(100%, 840px)' : 'min(100%, 920px)',
          height: expanded ? 'min(100%, 318px)' : 'clamp(160px, 26vh, 230px)',
          marginBottom: expanded ? 10 : 4,
          transition: 'height 200ms ease',
        }}
      >
        {applets.map((info, index) => (
          <RunningCard
            key={info.manifest.id}
            info={info}
            index={index}
            total={total}
            expanded={expanded}
            onOpen={() => onOpen(info.manifest.id)}
          />
        ))}
      </div>
      <button
        type="button"
        aria-label={t('applet.page.runningToggle')}
        onClick={onToggle}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          minWidth: 96,
          height: 24,
          border: 0,
          borderRadius: 999,
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        {applets.map((info) => (
          <span
            key={info.manifest.id}
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: token.colorTextQuaternary,
            }}
          />
        ))}
      </button>
    </section>
  );
}

function RunningCard({
  info,
  index,
  total,
  expanded,
  onOpen,
}: {
  info: RuntimeAppletInfo;
  index: number;
  total: number;
  expanded: boolean;
  onOpen: () => void;
}) {
  const { token } = theme.useToken();
  const { t } = useTranslation('applet');
  const [iconAssetFailed, setIconAssetFailed] = useState(false);
  const identity = appletIdentity(info);
  const shouldUseAsset = Boolean(identity.assetUrl && !iconAssetFailed);

  const offset = index - (total - 1) / 2;
  const compactWidth = total <= 1 ? 246 : total === 2 ? 226 : total === 3 ? 204 : total === 4 ? 188 : Math.max(154, 700 / total);
  const cardWidth = expanded ? 292 : compactWidth;
  const cardHeight = expanded ? 250 : Math.round(compactWidth * 0.62);
  const compactSpacing = compactWidth * (total <= 3 ? 0.58 : 0.48);
  const expandedSpacing = Math.min(190, Math.max(132, 680 / total));
  const spacing = expanded ? expandedSpacing : compactSpacing;
  const scale = 1 - Math.abs(offset) * (expanded ? 0.04 : 0.035);
  const zIndex = total * 10 - Math.round(Math.abs(offset) * 10);

  return (
    <article
      onClick={onOpen}
      style={
        {
          position: 'absolute',
          left: '50%',
          bottom: '50%',
          width: cardWidth,
          height: cardHeight,
          display: 'flex',
          flexDirection: 'column',
          padding: expanded ? 12 : 9,
          borderRadius: 18,
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgElevated,
          boxShadow: expanded ? token.boxShadowSecondary : token.boxShadowTertiary,
          cursor: 'pointer',
          zIndex,
          transform: `translateX(calc(-50% + ${offset * spacing}px)) translateY(50%) scale(${scale})`,
          transformOrigin: 'center center',
          transition: 'transform 200ms ease, height 200ms ease',
          overflow: 'hidden',
        } as CSSProperties
      }
    >
      <Flexbox horizontal align="center" gap={expanded ? 9 : 8} style={{ minWidth: 0, marginBottom: expanded ? 10 : 8 }}>
        <span
          style={{
            width: expanded ? 34 : 28,
            height: expanded ? 34 : 28,
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: expanded ? 11 : 9,
            background: shouldUseAsset ? token.colorBgLayout : identity.background,
            color: identity.foreground,
            boxShadow: `inset 0 0 0 1px ${token.colorBorderSecondary}`,
            overflow: 'hidden',
          }}
        >
          {shouldUseAsset ? (
            <img
              src={identity.assetUrl}
              alt=""
              draggable={false}
              onError={() => setIconAssetFailed(true)}
              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
            />
          ) : identity.icon ? (
            identity.icon
          ) : (
            <Text style={{ color: identity.foreground, fontSize: 14, fontWeight: 600, lineHeight: 1 }}>
              {identity.label}
            </Text>
          )}
        </span>
        <Flexbox style={{ minWidth: 0, flex: 1 }}>
          <Text
            strong
            style={{
              fontSize: 14,
              lineHeight: '18px',
              color: token.colorText,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {info.manifest.name}
          </Text>
          <Text type="secondary" style={{ fontSize: expanded ? 12 : 11, lineHeight: '16px' }}>
            {t('applet.page.running')}
          </Text>
        </Flexbox>
      </Flexbox>
      <AppletSnapshot info={info} compact={!expanded} />
    </article>
  );
}

function AppletSnapshot({ info, compact }: { info: RuntimeAppletInfo; compact: boolean }) {
  const { token } = theme.useToken();
  const [iconAssetFailed, setIconAssetFailed] = useState(false);
  const identity = appletIdentity(info);
  const shouldUseAsset = Boolean(identity.assetUrl && !iconAssetFailed);

  return (
    <div
      aria-hidden="true"
      style={{
        flex: 1,
        minHeight: compact ? 92 : 0,
        display: 'grid',
        gridTemplateColumns: compact ? '30px 1fr' : '42px 1fr',
        gap: compact ? 8 : 10,
        padding: compact ? 8 : 10,
        borderRadius: compact ? 12 : 18,
        background: token.colorFillQuaternary,
        overflow: 'hidden',
      }}
    >
      <Flexbox gap={compact ? 6 : 8}>
        {[0, 1, 2].map((item) => (
          <span
            key={item}
            style={{
              height: compact ? 18 : 28,
              borderRadius: compact ? 7 : 9,
              background: token.colorFillSecondary,
            }}
          />
        ))}
      </Flexbox>
      <Flexbox gap={compact ? 7 : 10} style={{ minWidth: 0 }}>
        <Flexbox horizontal align="center" justify="space-between" gap={8}>
          <Text
            type="secondary"
            style={{
              fontSize: compact ? 10 : 12,
              fontWeight: 650,
              lineHeight: '16px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {info.manifest.name}
          </Text>
        </Flexbox>
        <Flexbox
          horizontal
          align="center"
          gap={compact ? 7 : 10}
          style={{
            minHeight: compact ? 34 : 54,
            padding: compact ? 5 : 8,
            borderRadius: compact ? 10 : 15,
            background: token.colorBgContainer,
          }}
        >
          <span
            style={{
              width: compact ? 24 : 38,
              height: compact ? 24 : 38,
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: compact ? 8 : 12,
              color: identity.foreground,
              background: shouldUseAsset ? token.colorBgLayout : identity.background,
              boxShadow: `inset 0 0 0 1px ${token.colorBorderSecondary}`,
              overflow: 'hidden',
            }}
          >
            {shouldUseAsset ? (
              <img
                src={identity.assetUrl}
                alt=""
                draggable={false}
                onError={() => setIconAssetFailed(true)}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            ) : identity.icon ? (
              identity.icon
            ) : (
              <Text style={{ color: identity.foreground, fontSize: compact ? 10 : 14, fontWeight: 600, lineHeight: 1 }}>
                {identity.label}
              </Text>
            )}
          </span>
          <span
            style={{
              flex: 1,
              height: compact ? 16 : 26,
              borderRadius: 999,
              background: `linear-gradient(90deg, ${token.colorFillSecondary}, ${token.colorFillTertiary})`,
            }}
          />
        </Flexbox>
        <Flexbox gap={compact ? 5 : 7}>
          {[100, 76, 52].map((width) => (
            <span
              key={width}
              style={{
                width: `${width}%`,
                height: compact ? 6 : 9,
                borderRadius: 999,
                background: token.colorFillSecondary,
              }}
            />
          ))}
        </Flexbox>
      </Flexbox>
    </div>
  );
}

function LauncherEmptyState({ onImport }: { onImport: () => void }) {
  const { t } = useTranslation('applet');
  const { token } = theme.useToken();

  return (
    <Flexbox
      align="center"
      justify="center"
      gap={16}
      style={{ flex: '1 1 auto', padding: 24 }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 22,
          color: token.colorTextSecondary,
          background: token.colorFillQuaternary,
        }}
      >
        <PackageOpen size={32} />
      </div>
      <Flexbox align="center" gap={6} style={{ maxWidth: 360, textAlign: 'center' }}>
        <Text strong style={{ fontSize: 17 }}>
          {t('applet.page.emptyTitle')}
        </Text>
        <Text type="secondary" style={{ fontSize: 14, lineHeight: '22px' }}>
          {t('applet.page.empty')}
        </Text>
      </Flexbox>
      <button
        type="button"
        onClick={onImport}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 36,
          padding: '0 16px',
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: token.borderRadius,
          background: token.colorBgContainer,
          color: token.colorText,
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        <FileInput size={15} />
        {t('applet.page.importPackage')}
      </button>
    </Flexbox>
  );
}
