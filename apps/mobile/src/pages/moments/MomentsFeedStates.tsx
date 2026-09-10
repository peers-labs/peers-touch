/**
 * MomentsFeedStates.tsx — Empty, unavailable, and policy state renderers
 *
 * Pure renderers for feed edge cases:
 * - Empty feed (no posts, user needs to follow/join)
 * - Unavailable state (projection failure, service down)
 * - Policy violation (blocked, moderated content)
 * - Loading state (initial feed load)
 * - Error state (network failure with retry)
 *
 * All text uses i18n keys; no hardcoded strings.
 *
 * W6B: Initial implementation.
 */

import { Button, Typography } from 'antd';
import { AlertTriangle, Inbox, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';

const { Text, Title } = Typography;

// ---------------------------------------------------------------------------
// Empty feed
// ---------------------------------------------------------------------------

export function MomentsFeedEmpty() {
  const { t } = useMobileI18n();

  return (
    <div className="moments-state moments-state--empty" role="status">
      <Inbox size={48} strokeWidth={1.5} />
      <Title level={5}>{t('mobile.moments.feed.empty')}</Title>
      <Text type="secondary">{t('mobile.moments.feed.emptyHint')}</Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

export function MomentsFeedLoading() {
  const { t } = useMobileI18n();

  return (
    <div className="moments-state moments-state--loading" role="status">
      <RefreshCw size={24} className="moments-state__spinner" />
      <Text type="secondary">{t('mobile.moments.feed.loading')}</Text>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface MomentsFeedErrorProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function MomentsFeedError({ message: errorMessage, onRetry }: MomentsFeedErrorProps) {
  const { t } = useMobileI18n();

  return (
    <div className="moments-state moments-state--error" role="alert">
      <WifiOff size={36} strokeWidth={1.5} />
      <Title level={5}>{t('mobile.moments.feed.error')}</Title>
      {errorMessage && <Text type="secondary">{errorMessage}</Text>}
      <Button onClick={onRetry} icon={<RefreshCw size={14} />}>
        {t('mobile.moments.feed.retry')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unavailable state (projection failure)
// ---------------------------------------------------------------------------

interface MomentsUnavailableProps {
  readonly reason?: string;
  readonly onRetry: () => void;
}

export function MomentsUnavailable({ reason, onRetry }: MomentsUnavailableProps) {
  const { t } = useMobileI18n();

  return (
    <div className="moments-state moments-state--unavailable" role="alert">
      <AlertTriangle size={48} strokeWidth={1.5} />
      <Title level={5}>{t('mobile.moments.unavailable.title')}</Title>
      <Text type="secondary">
        {reason || t('mobile.moments.unavailable.description')}
      </Text>
      <Button onClick={onRetry}>
        {t('mobile.moments.unavailable.retry')}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Policy violation state
// ---------------------------------------------------------------------------

interface MomentsPolicyViolationProps {
  readonly blocked?: boolean;
}

export function MomentsPolicyViolation({ blocked }: MomentsPolicyViolationProps) {
  const { t } = useMobileI18n();

  return (
    <div className="moments-state moments-state--policy" role="alert">
      <ShieldAlert size={48} strokeWidth={1.5} />
      <Title level={5}>
        {blocked
          ? t('mobile.moments.policy.blocked')
          : t('mobile.moments.policy.violation')
        }
      </Title>
      <Text type="secondary">
        {blocked
          ? t('mobile.moments.policy.blockedHint')
          : t('mobile.moments.policy.violationHint')
        }
      </Text>
    </div>
  );
}
