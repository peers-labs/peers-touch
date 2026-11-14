import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Icon, Spin } from '@peers-touch/ui';

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
import { MobilePageActivity } from './mobilePageLifetime';

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
        routeId === 'tab:chat'
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

  const starting = status === 'pending'
    || status === 'bootstrapping'
    || status === 'resuming';
  const warmed = useRef(false);
  if (status === 'ready' || fixtureOwnsRoute) warmed.current = true;
  const available = status === 'ready'
    || fixtureOwnsRoute
    || nativeTransitionPreservesTree
    || (warmed.current && starting);
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

  return <>
    <MobilePageActivity visible={available}>{(available || warmed.current) ? children : null}</MobilePageActivity>
    {available ? null : (
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
            <Icon iconId="arrow-left" size={20} />
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
            ? <Spin active size="small" />
            : <Icon iconId="warning" size={22} />}
        </span>
        <strong className="mobile-route-state__title">
          {descriptor
            ? t(
                preparing
                  ? 'mobile.route.preparingTitle'
                  : 'mobile.route.unavailableTitle',
                { feature: featureName },
              )
            : t('mobile.launch.unavailable')}
        </strong>
        <span className="mobile-route-state__description">
          {t(
            preparing
              ? 'mobile.route.preparingBody'
              : 'mobile.route.unavailableBody',
          )}
        </span>
        {retryable || retrying ? (
          <span className="mobile-route-state__action">
            <Button
              actionId="mobile-route-retry"
              emphasis="primary"
              leading={<Icon iconId="refresh-cw" size={16} />}
              execution={retrying ? 'pending' : 'idle'}
              availability={retrying ? { kind: 'disabled', reason: t('common.action.retry') } : undefined}
              data-acceptance-id="mobile-route-retry"
              onActivate={() => { void retry(); }}
            >
              {t('common.action.retry')}
            </Button>
          </span>
        ) : null}
        {retryFailed ? (
          <span className="mobile-route-state__error" role="alert" data-tone="danger">
            {t('mobile.recovery.actionFailed')}
          </span>
        ) : null}
      </section>
    </div>
    )}
  </>;
}
