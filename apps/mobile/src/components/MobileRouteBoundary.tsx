import type { ReactNode } from 'react';
import { Spin, Typography } from 'antd';
import { ArrowLeft } from 'lucide-react';

import { readRuntimeAvailability, useLifecycleKernel } from '../app/lifecycle';
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

  if (status === 'ready' || fixtureOwnsRoute) return children;

  const starting = status === 'pending'
    || status === 'bootstrapping'
    || status === 'resuming';

  return (
    <div
      className="page-container"
      data-acceptance-id="mobile-route-unavailable"
      data-route-id={routeId}
      data-runtime-status={status ?? 'missing'}
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
          {t(descriptor?.labelKey ?? 'mobile.launch.unavailable')}
        </h1>
      </header>
      <section className="mobile-detail-body" role="status" aria-busy={starting}>
        {starting
          ? <Spin aria-label={t('mobile.recovery.deferredCapability.title')} />
          : <Typography.Text type="secondary">{t('mobile.launch.unavailable')}</Typography.Text>}
      </section>
    </div>
  );
}
