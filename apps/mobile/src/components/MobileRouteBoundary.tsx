import type { ReactNode } from 'react';
import { Spin, Typography } from 'antd';
import { ArrowLeft } from 'lucide-react';

import { readRuntimeAvailability, useLifecycleKernel } from '../app/lifecycle';
import { useMobileI18n } from '../app/mobileI18n';
import { findNavigationDescriptor } from '../app/navigation';

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
  const descriptor = findNavigationDescriptor(routeId);
  const status = descriptor
    ? readRuntimeAvailability(lifecycle, descriptor.ownerRuntimeId)?.status
    : undefined;

  if (status === 'ready') return children;

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
