import { ReactNode } from 'react';
import { Button, Spin, Typography, theme } from 'antd';
import {
  FileText,
  Inbox,
  Search,
  Settings2,
  RefreshCcw,
  AlertTriangle,
  Sparkles,
  PlugZap,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

// SocialEmptyState — a normalized empty/loading/degraded surface.
//
// UI Identity contract:
//   - Empty ≠ loading ≠ degraded ≠ not-implemented. Each has a
//     distinct visual treatment so the user knows what's going on.
//   - All four states look like part of the same design — not
//     disconnected components.
//   - The surface lives inside SocialContentRail; it does NOT
//     introduce its own card borders.
//
//   empty            — "nothing yet, start by posting"
//   loading          — spinner + "loading"
//   degraded         — data partially available, can try again
//   unavailable      — service not reachable right now
//   not-implemented  — capability is being built, will come later

export type SocialEmptyKind =
  | 'empty'
  | 'loading'
  | 'degraded'
  | 'unavailable'
  | 'not-implemented';

export interface SocialEmptyStateProps {
  kind: SocialEmptyKind;
  title?: string;
  description?: string;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  children?: ReactNode;
  compact?: boolean;
}

const { Text, Paragraph } = Typography;

export function SocialEmptyState({
  kind,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
  compact,
}: SocialEmptyStateProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');

  const content = buildContent({ kind, title, description, t });

  const iconSize = compact ? 28 : 34;
  const iconColor =
    kind === 'loading'
      ? token.colorPrimary
      : kind === 'degraded' || kind === 'unavailable'
        ? token.colorWarning
        : token.colorTextTertiary;

  const Icon = (() => {
    switch (kind) {
      case 'loading':
        return <FileText size={iconSize} color={iconColor} />;
      case 'degraded':
      case 'unavailable':
        return <AlertTriangle size={iconSize} color={iconColor} />;
      case 'not-implemented':
        return <Sparkles size={iconSize} color={iconColor} />;
      case 'empty':
      default:
        return <Inbox size={iconSize} color={iconColor} />;
    }
  })();

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 8,
        padding: compact ? '24px 12px' : '32px 18px',
        background: token.colorBgContainer,
        border: `1px dashed ${token.colorBorderSecondary}`,
        borderRadius: 14,
      }}
    >
      <div style={{ position: 'relative', display: 'inline-flex' }}>
        {kind === 'loading' ? <Spin size="large" /> : Icon}
      </div>
      <Paragraph
        style={{
          margin: 0,
          fontSize: compact ? 13 : 14,
          fontWeight: 600,
          color: token.colorText,
        }}
      >
        {content.title}
      </Paragraph>
      {content.description && (
        <Paragraph
          style={{
            margin: 0,
            fontSize: 12.5,
            lineHeight: 1.6,
            color: token.colorTextSecondary,
            maxWidth: 420,
          }}
        >
          {content.description}
        </Paragraph>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {kind === 'empty' && primaryAction && (
          <Button type="primary" size="small" onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        )}
        {kind === 'loading' && (
          <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {t('moments.empty.please-wait')}
          </Text>
        )}
        {(kind === 'degraded' || kind === 'unavailable') && (
          <>
            <Button
              type="text"
              size="small"
              icon={<RefreshCcw size={13} />}
              onClick={primaryAction?.onClick}
            >
              {primaryAction?.label ?? t('moments.empty.try-again')}
            </Button>
            {secondaryAction && (
              <Button size="small" onClick={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )}
          </>
        )}
        {kind === 'not-implemented' && (
          <>
            <Button
              type="text"
              size="small"
              icon={<PlugZap size={13} />}
              onClick={primaryAction?.onClick}
              disabled={!primaryAction}
            >
              {primaryAction?.label ?? t('moments.empty.not-implemented.cta')}
            </Button>
            <Button
              type="text"
              size="small"
              icon={<Settings2 size={13} />}
              onClick={secondaryAction?.onClick}
              disabled={!secondaryAction}
            >
              {secondaryAction?.label ?? t('moments.empty.settings')}
            </Button>
          </>
        )}
      </div>

      {children}
    </div>
  );
}

// Small helper for when you only want a search empty state.
export function SocialSearchEmpty({ query }: { query: string }) {
  const { token } = theme.useToken();
  const { t } = useTranslation('moments');
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 8,
        padding: '28px 16px',
        background: token.colorBgContainer,
        border: `1px dashed ${token.colorBorderSecondary}`,
        borderRadius: 14,
      }}
    >
      <Search size={28} color={token.colorTextTertiary} />
      <Paragraph style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>
        {t('moments.search.no-results.title')}
      </Paragraph>
      <Paragraph
        style={{ margin: 0, fontSize: 12.5, color: token.colorTextSecondary, maxWidth: 420 }}
      >
        {t('moments.search.no-results.description', { query })}
      </Paragraph>
    </div>
  );
}

function buildContent({
  kind,
  title,
  description,
  t,
}: {
  kind: SocialEmptyKind;
  title?: string;
  description?: string;
  t: (key: string, vars?: Record<string, unknown>) => string;
}) {
  const fallbackTitle: Record<SocialEmptyKind, string> = {
    empty: t('moments.empty.title'),
    loading: t('moments.empty.loading'),
    degraded: t('moments.empty.degraded.title'),
    unavailable: t('moments.empty.unavailable.title'),
    'not-implemented': t('moments.empty.not-implemented.title'),
  };
  const fallbackDescription: Record<SocialEmptyKind, string> = {
    empty: t('moments.empty.description'),
    loading: t('moments.empty.loading-description'),
    degraded: t('moments.empty.degraded.description'),
    unavailable: t('moments.empty.unavailable.description'),
    'not-implemented': t('moments.empty.not-implemented.description'),
  };
  return {
    title: title ?? fallbackTitle[kind],
    description: description ?? fallbackDescription[kind],
  };
}
