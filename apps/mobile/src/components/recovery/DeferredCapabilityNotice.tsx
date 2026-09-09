/**
 * DeferredCapabilityNotice — features unavailable during bootstrap.
 *
 * Reports lifecycle-owned startup/resume degradation without exposing raw
 * runtime identifiers or internal error strings as user-facing copy.
 */

import { LoaderCircle } from 'lucide-react';

import type { DeferredCapabilityState } from '../../runtimes/recoveryProjection';

interface DeferredCapabilityNoticeProps {
  readonly state: DeferredCapabilityState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function DeferredCapabilityNotice({ state, t }: DeferredCapabilityNoticeProps) {
  return (
    <section
      className="recovery-notice recovery-deferred-capability"
      role="status"
      aria-label={t('mobile.recovery.deferredCapability.title')}
      data-runtime-count={state.unavailableRuntimes.length}
    >
      <span className="recovery-notice__icon" aria-hidden="true">
        <LoaderCircle size={18} className="recovery-icon--spinning" />
      </span>
      <div className="recovery-notice__content">
        <strong className="recovery-notice__title">
          {t('mobile.recovery.deferredCapability.title')}
        </strong>
        <span className="recovery-notice__text">
          {t('mobile.recovery.deferredCapability.body', {
            count: state.unavailableRuntimes.length,
          })}
        </span>
      </div>
    </section>
  );
}
