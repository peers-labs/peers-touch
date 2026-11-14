/**
 * MomentsFeedStates.tsx — Empty, unavailable, and policy state renderers.
 *
 * Pure renderers for feed edge cases: empty, loading, error, unavailable,
 * and policy violation. All text uses i18n keys. Presentational only.
 */

import { Button, Icon } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';

export function MomentsFeedEmpty() {
  const { t } = useMobileI18n();

  return (
    <div
      className="moments-state moments-state--empty"
      data-product-surface="moments.feed-empty"
      role="status"
    >
      <Icon iconId="inbox" size={48} strokeWidth={1.5} />
      <h3 className="moments-state__title">{t('mobile.moments.feed.empty')}</h3>
      <span className="moments-state__body">{t('mobile.moments.feed.emptyHint')}</span>
    </div>
  );
}

export function MomentsFeedLoading({
  productSurface = 'moments.feed-loading',
}: {
  readonly productSurface?: string;
} = {}) {
  const { t } = useMobileI18n();

  return (
    <div
      className="moments-state moments-state--loading"
      data-product-surface={productSurface}
      role="status"
    >
      <Icon iconId="refresh-cw" size={24} className="moments-state__spinner" />
      <span className="moments-state__body">{t('mobile.moments.feed.loading')}</span>
    </div>
  );
}

interface MomentsFeedErrorProps {
  readonly message: string;
  readonly onRetry: () => void;
}

export function MomentsFeedError({ message: errorMessage, onRetry }: MomentsFeedErrorProps) {
  const { t } = useMobileI18n();

  return (
    <div
      className="moments-state moments-state--error"
      data-product-surface="moments.feed-error"
      role="alert"
    >
      <Icon iconId="wifi-off" size={36} strokeWidth={1.5} />
      <h3 className="moments-state__title">{t('mobile.moments.feed.error')}</h3>
      {errorMessage ? <span className="moments-state__body">{errorMessage}</span> : null}
      <Button
        actionId="moments.feed.retry"
        leading={<Icon iconId="refresh-cw" size={14} />}
        onActivate={onRetry}
      >
        {t('mobile.moments.feed.retry')}
      </Button>
    </div>
  );
}

interface MomentsUnavailableProps {
  readonly reason?: string;
  readonly onRetry: () => void;
  readonly productSurface?: string;
}

export function MomentsUnavailable({
  reason,
  onRetry,
  productSurface = 'moments.unavailable',
}: MomentsUnavailableProps) {
  const { t } = useMobileI18n();

  return (
    <div
      className="moments-state moments-state--unavailable"
      data-product-surface={productSurface}
      role="alert"
    >
      <Icon iconId="warning" size={48} strokeWidth={1.5} />
      <h3 className="moments-state__title">{t('mobile.moments.unavailable.title')}</h3>
      <span className="moments-state__body">
        {reason || t('mobile.moments.unavailable.description')}
      </span>
      <Button actionId="moments.unavailable.retry" onActivate={onRetry}>
        {t('mobile.moments.unavailable.retry')}
      </Button>
    </div>
  );
}

interface MomentsPolicyViolationProps {
  readonly blocked?: boolean;
  readonly productSurface?: string;
}

export function MomentsPolicyViolation({
  blocked,
  productSurface = 'moments.filtered-empty',
}: MomentsPolicyViolationProps) {
  const { t } = useMobileI18n();

  return (
    <div
      className="moments-state moments-state--policy"
      data-product-surface={productSurface}
      role="alert"
    >
      <Icon iconId="shield-alert" size={48} strokeWidth={1.5} />
      <h3 className="moments-state__title">
        {blocked
          ? t('mobile.moments.policy.blocked')
          : t('mobile.moments.policy.violation')}
      </h3>
      <span className="moments-state__body">
        {blocked
          ? t('mobile.moments.policy.blockedHint')
          : t('mobile.moments.policy.violationHint')}
      </span>
    </div>
  );
}
