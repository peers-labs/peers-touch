import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';

interface MomentActionsSheetProps {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onDelete: () => void;
}

export function MomentActionsSheet({
  busy,
  onClose,
  onDelete,
}: MomentActionsSheetProps) {
  const { t } = useMobileI18n();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div
        className="moments-sheet-backdrop"
        role="presentation"
        onPointerDown={onClose}
      >
        <section
          className="moments-bottom-sheet moments-confirm-sheet"
          role="alertdialog"
          aria-modal="true"
          aria-label={t('mobile.moments.delete.confirmTitle')}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="moments-sheet-handle" />
          <div className="moments-confirm-copy">
            <Trash2 size={20} />
            <div>
              <strong>{t('mobile.moments.delete.confirmTitle')}</strong>
              <p>{t('mobile.moments.delete.confirmDescription')}</p>
            </div>
          </div>
          <div className="moments-confirm-actions">
            <button type="button" disabled={busy} onClick={onClose}>
              {t('common.action.cancel')}
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              aria-busy={busy}
              onClick={onDelete}
            >
              {t('mobile.moments.delete.action')}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="moments-sheet-backdrop"
      role="presentation"
      onPointerDown={onClose}
    >
      <section
        className="moments-bottom-sheet moments-actions-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('mobile.moments.actions')}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="moments-sheet-handle" />
        <div className="moments-actions-group">
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={18} />
            {t('mobile.moments.delete.action')}
          </button>
        </div>
      </section>
    </div>
  );
}
