/**
 * DeferredCapabilityNotice — features unavailable during bootstrap.
 *
 * Reports lifecycle-owned startup/resume degradation without exposing raw
 * runtime identifiers or internal error strings as user-facing copy.
 */

import { useState } from 'react';
import { AlertCircle, LoaderCircle, RefreshCw } from 'lucide-react';

import type { DeferredCapabilityState } from '../../runtimes/recoveryProjection';

interface DeferredCapabilityNoticeProps {
  readonly state: DeferredCapabilityState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onRetry: () => Promise<void>;
  readonly canRetry: boolean;
}

export function DeferredCapabilityNotice({
  state,
  t,
  onRetry,
  canRetry,
}: DeferredCapabilityNoticeProps) {
  const failed = state.unavailableRuntimes.some((entry) => entry.status === 'failed');
  const [retrying, setRetrying] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const titleKey = failed
    ? 'mobile.recovery.deferredCapability.failedTitle'
    : 'mobile.recovery.deferredCapability.title';

  async function retry() {
    if (!canRetry || retrying) return;
    setRetrying(true);
    setActionFailed(false);
    try {
      await onRetry();
    } catch {
      setActionFailed(true);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <section
      className="recovery-notice recovery-deferred-capability"
      data-acceptance-id="recovery-deferred-capability"
      role="status"
      aria-label={t(titleKey)}
      aria-busy={!failed || retrying}
      data-runtime-count={state.unavailableRuntimes.length}
    >
      <span className="recovery-notice__icon" aria-hidden="true">
        {failed && !retrying
          ? <AlertCircle size={18} />
          : <LoaderCircle size={18} className="recovery-icon--spinning" />}
      </span>
      <div className="recovery-notice__content">
        <strong className="recovery-notice__title">
          {t(titleKey)}
        </strong>
        <span className="recovery-notice__text">
          {t(failed
            ? 'mobile.recovery.deferredCapability.failedBody'
            : 'mobile.recovery.deferredCapability.body', {
            count: state.unavailableRuntimes.length,
          })}
        </span>
        {failed && (
          <div className="recovery-notice__actions">
            <button
              type="button"
              data-acceptance-id="recovery-deferred-capability-retry"
              className="recovery-btn recovery-btn--compact recovery-btn--primary"
              disabled={!canRetry || retrying}
              onClick={() => { void retry(); }}
            >
              <RefreshCw
                size={14}
                className={retrying ? 'recovery-icon--spinning' : undefined}
                aria-hidden="true"
              />
              {t('common.action.retry')}
            </button>
          </div>
        )}
        {actionFailed && (
          <span className="recovery-notice__error" role="alert">
            {t('mobile.recovery.actionFailed')}
          </span>
        )}
      </div>
    </section>
  );
}
