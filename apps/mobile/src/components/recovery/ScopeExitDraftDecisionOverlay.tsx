import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, Trash2 } from 'lucide-react';

import type { DraftDisposition } from '../../app/lifecycle/types';

export type ScopeExitDecisionReason =
  | 'station-replace'
  | 'actor-replace'
  | 'logout';

interface ScopeExitDraftDecisionOverlayProps {
  readonly reason: ScopeExitDecisionReason;
  readonly draftCount: number;
  readonly committedDisposition: DraftDisposition | null;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly onDecision: (disposition: DraftDisposition) => Promise<void>;
  readonly onCancel: () => Promise<void>;
  readonly canCancel: boolean;
}

export function ScopeExitDraftDecisionOverlay({
  reason,
  draftCount,
  committedDisposition,
  t,
  onDecision,
  onCancel,
  canCancel,
}: ScopeExitDraftDecisionOverlayProps) {
  const retainRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<DraftDisposition | null>(null);
  const [actionFailed, setActionFailed] = useState(false);
  const autoCommitStartedRef = useRef(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    retainRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (
      draftCount !== 0
      || committedDisposition === null
      || autoCommitStartedRef.current
    ) {
      return;
    }
    autoCommitStartedRef.current = true;
    void decide(committedDisposition);
  }, [committedDisposition, draftCount]);

  async function decide(disposition: DraftDisposition) {
    if (pendingAction) return;
    if (
      committedDisposition
      && committedDisposition !== disposition
    ) return;
    setActionFailed(false);
    setPendingAction(disposition);
    try {
      await onDecision(disposition);
    } catch {
      setActionFailed(true);
    } finally {
      setPendingAction(null);
    }
  }

  const reasonKey = reason === 'station-replace'
    ? 'mobile.recovery.scopeExitDraft.stationBody'
    : reason === 'actor-replace'
      ? 'mobile.recovery.scopeExitDraft.actorBody'
      : 'mobile.recovery.scopeExitDraft.logoutBody';
  const decisionCommitted = committedDisposition !== null;
  const retryLabel = t('mobile.recovery.scopeExitDraft.retry');

  return (
    <div
      className="recovery-overlay recovery-scope-exit"
      data-acceptance-id="recovery-scope-exit"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="recovery-scope-exit-title"
      aria-describedby="recovery-scope-exit-description"
      aria-busy={pendingAction !== null}
    >
      <div className="recovery-overlay__backdrop" />
      <section className="recovery-overlay__panel">
        <h2 id="recovery-scope-exit-title" className="recovery-overlay__title">
          {t(
            draftCount === 0
              ? 'mobile.recovery.scopeExitDraft.finishingTitle'
              : 'mobile.recovery.scopeExitDraft.title',
          )}
        </h2>
        <p id="recovery-scope-exit-description" className="recovery-overlay__body">
          {t(
            draftCount === 0
              ? 'mobile.recovery.scopeExitDraft.finishingBody'
              : reasonKey,
            { count: draftCount },
          )}
        </p>
        <div className="recovery-overlay__actions">
          <button
            ref={committedDisposition === 'discard' ? undefined : retainRef}
            type="button"
            data-acceptance-id="recovery-scope-exit-retain"
            className="recovery-btn recovery-btn--primary"
            disabled={
              pendingAction !== null
              || (decisionCommitted && committedDisposition !== 'retain')
            }
            onClick={() => {
              void decide('retain');
            }}
          >
            <ArchiveRestore size={16} aria-hidden="true" />
            {committedDisposition === 'retain'
              ? retryLabel
              : t('mobile.recovery.scopeExitDraft.retain')}
          </button>
          <button
            ref={committedDisposition === 'discard' ? retainRef : undefined}
            type="button"
            data-acceptance-id="recovery-scope-exit-discard"
            className="recovery-btn recovery-btn--danger"
            disabled={
              pendingAction !== null
              || (decisionCommitted && committedDisposition !== 'discard')
            }
            onClick={() => {
              void decide('discard');
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            {committedDisposition === 'discard'
              ? retryLabel
              : t('mobile.recovery.scopeExitDraft.discard')}
          </button>
          <button
            type="button"
            data-acceptance-id="recovery-scope-exit-cancel"
            className="recovery-btn recovery-btn--secondary"
            disabled={pendingAction !== null || !canCancel}
            onClick={() => {
              setActionFailed(false);
              setPendingAction('retain');
              void onCancel()
                .catch(() => setActionFailed(true))
                .finally(() => setPendingAction(null));
            }}
          >
            {t('common.action.cancel')}
          </button>
        </div>
        {actionFailed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.scopeExitDraft.error')}
          </span>
        )}
      </section>
    </div>
  );
}
