import type { ReactNode } from 'react';
import { Button, Empty, Spin } from '@peers-touch/ui';
import {
  Inbox,
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

export function SocialEmptyState({
  kind,
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
  compact,
}: SocialEmptyStateProps) {
  const { t } = useTranslation('moments');

  const content = buildContent({ kind, title, description, t });

  const iconSize = compact ? 28 : 34;
  const iconColor =
    kind === 'loading'
      ? 'var(--pt-primary)'
      : kind === 'degraded' || kind === 'unavailable'
        ? 'var(--pt-warning)'
        : 'var(--pt-muted)';

  const Icon = (() => {
    switch (kind) {
      case 'loading':
        return <Spin size="large" />;
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
    <Empty data-social-empty-kind={kind} icon={Icon} description={<strong>{content.title}</strong>}
      style={{ padding: compact ? '24px 12px' : '32px 18px' }}>
      {content.description && (
        <p
          style={{
            margin: 0,
            color: 'var(--pt-secondary)',
            maxWidth: 420,
          }}
        >
          {content.description}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
        {kind === 'empty' && primaryAction && (
          <Button actionId="moments.empty.create" emphasis="primary" density="compact" onActivate={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        )}
        {kind === 'loading' && (
          <span>
            {t('moments.empty.please-wait')}
          </span>
        )}
        {(kind === 'degraded' || kind === 'unavailable') && (
          <>
            <Button
              actionId="moments.empty.retry"
              emphasis="quiet"
              density="compact"
              leading={<RefreshCcw size={13} />}
              onActivate={primaryAction?.onClick}
              availability={!primaryAction ? { kind: 'disabled', reason: content.description } : undefined}
            >
              {primaryAction?.label ?? t('moments.empty.try-again')}
            </Button>
            {secondaryAction && (
              <Button actionId="moments.empty.secondary" density="compact" onActivate={secondaryAction.onClick}>
                {secondaryAction.label}
              </Button>
            )}
          </>
        )}
        {kind === 'not-implemented' && (
          <>
            <Button
              actionId="moments.empty.capability"
              emphasis="quiet"
              density="compact"
              leading={<PlugZap size={13} />}
              onActivate={primaryAction?.onClick}
              availability={!primaryAction ? { kind: 'disabled', reason: content.description } : undefined}
            >
              {primaryAction?.label ?? t('moments.empty.not-implemented.cta')}
            </Button>
            <Button
              actionId="moments.empty.settings"
              emphasis="quiet"
              density="compact"
              leading={<Settings2 size={13} />}
              onActivate={secondaryAction?.onClick}
              availability={!secondaryAction ? { kind: 'disabled', reason: content.description } : undefined}
            >
              {secondaryAction?.label ?? t('moments.empty.settings')}
            </Button>
          </>
        )}
      </div>

      {children}
    </Empty>
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
