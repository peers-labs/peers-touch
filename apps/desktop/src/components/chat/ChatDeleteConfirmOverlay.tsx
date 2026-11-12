import { useTranslation } from 'react-i18next';
import { Button as PtButton, Dialog } from '@peers-touch/ui';

interface ChatDeleteConfirmOverlayProps {
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Message delete confirmation, used by both the main chat and the thread
 * panel. The parent mounts it only while a delete target exists, so the Dialog
 * is open for its whole lifetime; peers Dialog owns the scrim, entrance
 * motion, focus trap and ESC/outside dismissal.
 */
export function ChatDeleteConfirmOverlay({
  deleting,
  onCancel,
  onConfirm,
}: ChatDeleteConfirmOverlayProps) {
  const { t } = useTranslation('chat');

  return (
    <Dialog
      open
      onDismiss={() => {
        if (!deleting) onCancel();
      }}
      title={t('chat.social.messageArea.deleteConfirmTitle')}
      description={t('chat.social.messageArea.deleteConfirmBody')}
      width={320}
      closeLabel={t('chat.social.messageArea.cancel')}
      footer={
        <>
          <PtButton
            actionId="delete-message-cancel"
            onActivate={onCancel}
            availability={deleting
              ? { kind: 'disabled', reason: t('chat.social.messageArea.deleteConfirmOk') }
              : undefined}
          >
            {t('chat.social.messageArea.cancel')}
          </PtButton>
          <PtButton
            actionId="delete-message-confirm"
            emphasis="primary"
            tone="danger"
            execution={deleting ? 'pending' : 'idle'}
            onActivate={onConfirm}
          >
            {t('chat.social.messageArea.deleteConfirmOk')}
          </PtButton>
        </>
      }
    />
  );
}
