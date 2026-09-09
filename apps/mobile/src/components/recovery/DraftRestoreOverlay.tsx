/**
 * DraftRestoreOverlay — prompts user to restore unsaved drafts.
 *
 * Reads draft list from the recovery projection and dispatches
 * restore/discard actions to the DraftRestorationPort owner.
 * This component does not own persistence or retry logic.
 */

import { useCallback } from 'react';

import type { DraftRestorePending } from '../../runtimes/recoveryProjection';
import { getRecoveryProjection } from '../../runtimes/recoveryProjection';

interface DraftRestoreOverlayProps {
  readonly state: DraftRestorePending;
  readonly t: (key: string, params?: Record<string, string | number>) => string;
}

export function DraftRestoreOverlay({ state, t }: DraftRestoreOverlayProps) {
  const handleRestore = useCallback(() => {
    // The owning runtime (commandRuntime) performs the actual restore.
    // We only clear the recovery projection state.
    window.dispatchEvent(new CustomEvent('recovery:draft-restore', { detail: { action: 'restore' } }));
    getRecoveryProjection().clearDraftRestore();
  }, []);

  const handleDiscard = useCallback(() => {
    window.dispatchEvent(new CustomEvent('recovery:draft-restore', { detail: { action: 'discard' } }));
    getRecoveryProjection().clearDraftRestore();
  }, []);

  return (
    <div
      className="recovery-overlay recovery-draft-restore"
      role="dialog"
      aria-modal="true"
      aria-label={t('mobile.recovery.draftRestore.title')}
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
            className="recovery-btn recovery-btn--secondary"
            onClick={handleDiscard}
          >
            {t('mobile.recovery.draftRestore.discard')}
          </button>
          <button
            type="button"
            className="recovery-btn recovery-btn--primary"
            onClick={handleRestore}
          >
            {t('mobile.recovery.draftRestore.restore')}
          </button>
        </div>
      </div>
    </div>
  );
}
