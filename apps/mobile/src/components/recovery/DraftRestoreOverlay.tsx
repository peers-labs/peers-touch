/**
 * DraftRestoreOverlay — prompts user to restore unsaved drafts.
 *
 * Reads draft list from the recovery projection and dispatches
 * restore/discard actions to the DraftRestorationPort owner.
 * This component does not own persistence or retry logic.
 */

import { useEffect, useRef, useState } from 'react';

import {
  discardReliabilityDrafts,
  restoreReliabilityDrafts,
} from '../../runtimes/commandRuntime';
import type { DraftRestorePending } from '../../runtimes/recoveryProjection';
import { getRecoveryProjection } from '../../runtimes/recoveryProjection';

interface DraftRestoreOverlayProps {
  readonly state: DraftRestorePending;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
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

export function DraftRestoreOverlay({ state, t }: DraftRestoreOverlayProps) {
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const [pendingAction, setPendingAction] = useState<'restore' | 'discard' | null>(null);
  const [actionFailed, setActionFailed] = useState(false);

  useEffect(() => {
    primaryActionRef.current?.focus();
  }, []);

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
      role="dialog"
      aria-modal="true"
      aria-label={t('mobile.recovery.draftRestore.title')}
      aria-busy={pendingAction !== null}
    >
      <div className="recovery-overlay__backdrop" />
      <div className="recovery-overlay__panel">
        <h3 className="recovery-overlay__title">
          {t('mobile.recovery.draftRestore.title')}
        </h3>
        <p className="recovery-overlay__body">
          {t('mobile.recovery.draftRestore.body', { count: state.drafts.length })}
        </p>
        <ul className="recovery-draft-list" role="list">
          {state.drafts.map((draft) => (
            <li key={draft.key} className="recovery-draft-list__item">
              <span className="recovery-draft-list__kind">{draft.kind}</span>
              <span className="recovery-draft-list__key">{draft.key}</span>
            </li>
          ))}
        </ul>
        <div className="recovery-overlay__actions">
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
        </div>
        {actionFailed && (
          <span className="recovery-panel__error" role="alert">
            {t('mobile.recovery.actionFailed')}
          </span>
        )}
      </div>
    </div>
  );
}
