import { useEffect, useRef, useState } from 'react';
import { Archive, RotateCcw, Trash2 } from 'lucide-react';

import type { LegacyReliabilityRecoveryState } from '../../runtimes/recoveryProjection';

export type LegacyReliabilityRecoveryAction =
  | 'retain'
  | 'discard-legacy'
  | 'reset-all';

interface LegacyReliabilityRecoveryOverlayProps {
  readonly state: LegacyReliabilityRecoveryState;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onAction: (action: LegacyReliabilityRecoveryAction) => Promise<void>;
}

export function LegacyReliabilityRecoveryOverlay({
  state,
  t,
  onAction,
}: LegacyReliabilityRecoveryOverlayProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] =
    useState<LegacyReliabilityRecoveryAction | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    primaryActionRef.current?.focus();
  }, []);

  useEffect(() => {
    setConfirmReset(false);
  }, [state.archivedLegacyFiles, state.retainedReadOnly]);

  async function runAction(action: LegacyReliabilityRecoveryAction) {
    if (pendingAction) return;
    if (action === 'reset-all' && !confirmReset) {
      setConfirmReset(true);
      return;
    }
    if (action !== 'reset-all') {
      setConfirmReset(false);
    }
    setActionFailed(false);
    setPendingAction(action);
    try {
      await onAction(action);
    } catch {
      setActionFailed(true);
    } finally {
      setPendingAction(null);
    }
  }

  const content = (
    <>
      <div className="recovery-notice__content">
        <strong
          id="legacy-reliability-title"
          className={state.retainedReadOnly
            ? 'recovery-notice__title'
            : 'recovery-overlay__title'}
        >
          {t('mobile.recovery.legacy.title')}
        </strong>
        <span
          id="legacy-reliability-description"
          className={state.retainedReadOnly
            ? 'recovery-notice__text'
            : 'recovery-overlay__body'}
        >
          {t(
            state.retainedReadOnly
              ? 'mobile.recovery.legacy.readOnly'
              : 'mobile.recovery.legacy.body',
            { count: state.archivedLegacyFiles },
          )}
        </span>
        <div className={state.retainedReadOnly
          ? 'recovery-notice__actions'
          : 'recovery-overlay__actions'}
        >
          {!state.retainedReadOnly && (
            <button
              ref={primaryActionRef}
              type="button"
              data-acceptance-id="recovery-legacy-retain"
              className="recovery-btn recovery-btn--primary"
              disabled={pendingAction !== null}
              onClick={() => {
                void runAction('retain');
              }}
            >
              <Archive size={16} aria-hidden="true" />
              {t('mobile.recovery.legacy.retain')}
            </button>
          )}
          <button
            ref={state.retainedReadOnly ? primaryActionRef : undefined}
            type="button"
            data-acceptance-id="recovery-legacy-discard"
            className="recovery-btn recovery-btn--secondary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('discard-legacy');
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            {t('mobile.recovery.legacy.discardLegacy')}
          </button>
          <button
            type="button"
            data-acceptance-id="recovery-legacy-reset"
            className="recovery-btn recovery-btn--danger"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('reset-all');
            }}
          >
            <RotateCcw size={16} aria-hidden="true" />
            {t(
              confirmReset
                ? 'mobile.recovery.legacy.resetConfirm'
                : 'mobile.recovery.legacy.resetAll',
            )}
          </button>
        </div>
        {confirmReset && !pendingAction && (
          <span className="recovery-panel__error" role="status">
            {t('mobile.recovery.legacy.resetWarning')}
          </span>
        )}
        {actionFailed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.legacy.error')}
          </span>
        )}
      </div>
    </>
  );

  if (state.retainedReadOnly) {
    return (
      <section
        className="recovery-notice recovery-legacy-read-only"
        data-acceptance-id="recovery-legacy-read-only"
        role="status"
        aria-labelledby="legacy-reliability-title"
        aria-describedby="legacy-reliability-description"
        aria-busy={pendingAction !== null}
      >
        <span className="recovery-notice__icon" aria-hidden="true">
          <Archive size={18} />
        </span>
        {content}
      </section>
    );
  }

  return (
    <div
      className="recovery-overlay recovery-legacy-reliability"
      data-acceptance-id="recovery-legacy"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="legacy-reliability-title"
      aria-describedby="legacy-reliability-description"
      aria-busy={pendingAction !== null}
    >
      <div className="recovery-overlay__backdrop" />
      <section className="recovery-overlay__panel">
        {content}
      </section>
    </div>
  );
}
