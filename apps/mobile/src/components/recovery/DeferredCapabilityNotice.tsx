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
  readonly compact?: boolean;
}

export function DeferredCapabilityNotice({
  state,
  t,
  onRetry,
  canRetry,
  compact = false,
}: DeferredCapabilityNoticeProps) {
  const failed = state.unavailableRuntimes.some((entry) => entry.status === 'failed');
  const [retrying, setRetrying] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const titleKey = failed
    ? 'mobile.recovery.deferredCapability.failedTitle'
    : 'mobile.recovery.deferredCapability.title';
  const body = t(failed
    ? 'mobile.recovery.deferredCapability.failedBody'
    : 'mobile.recovery.deferredCapability.body', {
    count: state.unavailableRuntimes.length,
  });

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
      className={`recovery-notice recovery-deferred-capability${compact ? ' compact' : ''}`}
      data-acceptance-id="recovery-deferred-capability"
      data-product-surface="shell.degraded-module-notice"
      role="status"
      aria-label={`${t(titleKey)}. ${body}`}
      aria-busy={!failed || retrying}
      data-blocks-unrelated-content="false"
      data-runtime-count={state.unavailableRuntimes.length}
      data-runtime-ids={state.unavailableRuntimes.map((entry) => entry.runtimeId).join(',')}
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
        {!compact ? <span className="recovery-notice__text">{body}</span> : null}
        {failed && (
          <div className="recovery-notice__actions">
            <button
              type="button"
              data-acceptance-id="recovery-deferred-capability-retry"
              className={`recovery-btn recovery-btn--compact recovery-btn--primary${compact ? ' icon-only' : ''}`}
              disabled={!canRetry || retrying}
              aria-label={t('common.action.retry')}
              title={t('common.action.retry')}
              onClick={() => { void retry(); }}
            >
              <RefreshCw
                size={14}
                className={retrying ? 'recovery-icon--spinning' : undefined}
                aria-hidden="true"
              />
              {!compact ? t('common.action.retry') : null}
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
