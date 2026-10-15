/**
 * DraftRestoreOverlay — prompts user to restore unsaved drafts.
 *
 * Reads draft list from the recovery projection and dispatches
 * restore/discard actions to the DraftRestorationPort owner.
 * This component does not own persistence or retry logic.
 */

import { useEffect, useRef, useState } from 'react';
import { FileClock } from 'lucide-react';

import {
  discardReliabilityDrafts,
  restoreReliabilityDrafts,
} from '../../runtimes/commandRuntime';
import type { DraftRestorePending } from '../../runtimes/recoveryProjection';
import { getRecoveryProjection } from '../../runtimes/recoveryProjection';

interface DraftRestoreOverlayProps {
  readonly state: DraftRestorePending;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
  readonly forceActionFailed?: boolean;
}

export async function executeDraftRestoreAction(
  action: 'restore' | 'discard',
  drafts: DraftRestorePending['drafts'],
): Promise<void> {
  if (action === 'restore') {
    await restoreReliabilityDrafts(drafts);
  } else {
    await discardReliabilityDrafts(drafts);
  }
  getRecoveryProjection().clearDraftRestore();
}

export function DraftRestoreOverlay({
  state,
  t,
  forceActionFailed = false,
}: DraftRestoreOverlayProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<'restore' | 'discard' | null>(null);
  const [actionFailed, setActionFailed] = useState(forceActionFailed);

  useEffect(() => {
    const previousFocus = document.activeElement;
    primaryActionRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    setActionFailed(forceActionFailed);
  }, [forceActionFailed]);

  async function runAction(action: 'restore' | 'discard') {
    if (pendingAction) return;
    setActionFailed(false);
    setPendingAction(action);
    try {
      await executeDraftRestoreAction(action, state.drafts);
    } catch {
      setActionFailed(true);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div
      className="recovery-overlay recovery-draft-restore"
      data-acceptance-id="recovery-draft-restore"
      data-product-surface={
        actionFailed ? 'recovery.draft-restore-failed' : undefined
      }
      data-blocks-unrelated-content="true"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-draft-restore-title"
      aria-describedby="recovery-draft-restore-description"
      aria-busy={pendingAction !== null}
    >
      <div className="recovery-overlay__backdrop" aria-hidden="true" />
      <section className="recovery-action-sheet recovery-draft-restore__sheet">
        <div className="recovery-action-sheet__handle" aria-hidden="true" />
        <span className="recovery-action-sheet__icon" aria-hidden="true">
          <FileClock size={22} />
        </span>
        <h2
          id="recovery-draft-restore-title"
          className="recovery-action-sheet__title"
        >
          {t('mobile.recovery.draftRestore.title')}
        </h2>
        <p
          id="recovery-draft-restore-description"
          className="recovery-action-sheet__body"
        >
          {t('mobile.recovery.draftRestore.body', { count: state.drafts.length })}
        </p>
        <div className="recovery-overlay__actions">
          <button
            ref={primaryActionRef}
            type="button"
            data-acceptance-id="recovery-draft-restore-action"
            className="recovery-btn recovery-btn--primary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('restore');
            }}
          >
            {t('mobile.recovery.draftRestore.restore')}
          </button>
          <button
            type="button"
            data-acceptance-id="recovery-draft-discard"
            className="recovery-btn recovery-btn--secondary"
            disabled={pendingAction !== null}
            onClick={() => {
              void runAction('discard');
            }}
          >
            {t('mobile.recovery.draftRestore.discard')}
          </button>
        </div>
        {actionFailed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.actionFailed')}
          </span>
        )}
      </section>
    </div>
  );
}
