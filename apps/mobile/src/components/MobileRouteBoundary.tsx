import { useEffect, useState, type ReactNode } from 'react';
import { Button, Spin, Typography } from 'antd';
import { AlertCircle, ArrowLeft, RefreshCw } from 'lucide-react';

import {
  getMobileLifecycleKernel,
  readRuntimeAvailability,
  useLifecycleKernel,
} from '../app/lifecycle';
import { useMobileI18n } from '../app/mobileI18n';
import { findNavigationDescriptor } from '../app/navigation';
import { useChatSurfaceFixture } from '../acceptance/chatSurfaceFixture';
import { useContactsSurfaceFixture } from '../acceptance/contactsSurfaceFixture';
import { useMomentsSurfaceFixture } from '../acceptance/momentsSurfaceFixture';
import { useSettingsSurfaceFixture } from '../acceptance/settingsSurfaceFixture';

interface MobileRouteBoundaryProps {
  readonly routeId: string;
  readonly onBack: () => void;
  readonly children: ReactNode;
}

export function MobileRouteBoundary({
  routeId,
  onBack,
  children,
}: MobileRouteBoundaryProps) {
  const { t } = useMobileI18n();
  const lifecycle = useLifecycleKernel();
  const chatFixture = useChatSurfaceFixture();
  const contactsFixture = useContactsSurfaceFixture();
  const momentsFixture = useMomentsSurfaceFixture();
  const settingsFixture = useSettingsSurfaceFixture();
  const descriptor = findNavigationDescriptor(routeId);
  const status = descriptor
    ? readRuntimeAvailability(lifecycle, descriptor.ownerRuntimeId)?.status
    : undefined;
  const fixtureOwnsRoute = (
    Boolean(chatFixture.surfaceId)
      && (
        routeId === 'tab:chat'
        || routeId === 'detail:chat-conversation'
        || routeId === 'detail:group-conversation'
      )
  ) || (
    Boolean(contactsFixture.surfaceId)
      && (
        routeId === 'tab:contacts'
        || routeId === 'detail:contact-profile'
      )
  ) || (
    Boolean(momentsFixture.surfaceId)
      && (
        routeId === 'tab:moments'
        || routeId.startsWith('detail:moment')
        || routeId.startsWith('detail:social-')
      )
  ) || (
    Boolean(settingsFixture.surfaceId)
      && (
        routeId === 'tab:settings'
        || routeId === 'detail:setting'
      )
  );
  const nativeTransitionPreservesTree = (
    lifecycle.launchState === 'background'
    || lifecycle.launchState === 'resume'
  ) && (
    status === 'suspended'
    || status === 'resuming'
  );
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);

  useEffect(() => {
    setRetrying(false);
    setRetryFailed(false);
  }, [routeId]);

  if (
    status === 'ready'
    || fixtureOwnsRoute
    || nativeTransitionPreservesTree
  ) return children;

  const starting = status === 'pending'
    || status === 'bootstrapping'
    || status === 'resuming';
  const preparing = starting || retrying;
  const retryable = Boolean(
    descriptor
    && (
      (lifecycle.phase === 'ACTIVE' && status === 'failed')
      || (lifecycle.phase === 'SUSPENDED' && status === 'suspended')
    ),
  );
  const featureName = descriptor
    ? t(descriptor.labelKey)
    : t('mobile.launch.unavailable');

  async function retry() {
    if (!retryable || retrying) return;
    setRetrying(true);
    setRetryFailed(false);
    try {
      await getMobileLifecycleKernel().restartRuntimeGraph('app-resume');
    } catch {
      setRetryFailed(true);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className="page-container"
      data-acceptance-id="mobile-route-unavailable"
      data-route-id={routeId}
      data-runtime-status={status ?? 'missing'}
      data-route-state={preparing ? 'preparing' : 'unavailable'}
    >
      <header className="page-header">
        {descriptor?.layout === 'detail' && (
          <button
            type="button"
            className="header-action"
            aria-label={t('common.action.back')}
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <h1 className={`header-title${descriptor?.layout === 'detail' ? ' compact' : ''}`}>
          {featureName}
        </h1>
      </header>
      <section
        className="mobile-route-state"
        role={preparing ? 'status' : 'alert'}
        aria-live="polite"
        aria-busy={preparing}
      >
        <span className="mobile-route-state__icon" aria-hidden="true">
          {preparing
            ? <Spin size="small" />
            : <AlertCircle size={22} />}
        </span>
        <Typography.Text strong className="mobile-route-state__title">
          {descriptor
            ? t(
                preparing
                  ? 'mobile.route.preparingTitle'
                  : 'mobile.route.unavailableTitle',
                { feature: featureName },
              )
            : t('mobile.launch.unavailable')}
        </Typography.Text>
        <Typography.Text type="secondary" className="mobile-route-state__description">
          {t(
            preparing
              ? 'mobile.route.preparingBody'
              : 'mobile.route.unavailableBody',
          )}
        </Typography.Text>
        {retryable || retrying ? (
          <Button
            type="primary"
            icon={<RefreshCw size={16} />}
            loading={retrying}
            disabled={retrying}
            data-acceptance-id="mobile-route-retry"
            onClick={() => { void retry(); }}
          >
            {t('common.action.retry')}
          </Button>
        ) : null}
        {retryFailed ? (
          <Typography.Text type="danger" role="alert">
            {t('mobile.recovery.actionFailed')}
          </Typography.Text>
        ) : null}
      </section>
    </div>
  );
}
