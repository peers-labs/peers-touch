import { Clock3, Pencil, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button as PtButton, Tag as PtTag, Tooltip as PtTooltip } from '@peers-touch/ui';
import { useChatStore } from '../../store/chat';

export function TurnQueueTray() {
  const { t } = useTranslation('chat');
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const queue = useChatStore((state) => state.turnQueues[state.currentSessionKey]);
  const cancelQueuedTurn = useChatStore((state) => state.cancelQueuedTurn);
  const setComposerDraft = useChatStore((state) => state.setComposerDraft);
  const entries = queue?.entries ?? [];

  const cancelAndEdit = async (entryId: string, text: string) => {
    await cancelQueuedTurn(currentSessionKey, entryId);
    setComposerDraft(currentSessionKey, text);
  };

  if (entries.length === 0) return null;

  return (
    <div
      className="sc-queue"
      data-pt-agent-turn-queue={currentSessionKey}
      aria-label={t('chat.queue.title', { count: entries.length })}
      tabIndex={-1}
    >
      <div className="sc-queue__title">
        <Clock3 aria-hidden size={14} />
        <span>{t('chat.queue.title', { count: entries.length })}</span>
      </div>
      {entries.map((entry) => (
        <div className="sc-queue__entry" key={entry.queue_entry_id} data-pt-agent-queue-entry={entry.queue_entry_id}>
          <span className="sc-queue__position" data-pt-agent-queue-position={entry.queue_position}>
            {t('chat.queue.position', { position: entry.queue_position })}
          </span>
          <span
            className="sc-queue__text"
            data-pt-agent-queue-locate-message={entry.queue_entry_id}
            title={t('chat.queue.showInConversation')}
            onClick={() => {
              document
                .querySelector(`[data-pt-agent-message-queue-entry="${entry.queue_entry_id}"]`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
          >
            {entry.user_input}
          </span>
          {entry.client_capability_session_id && (
            <PtTag>
              {t('chat.queue.snapshot')}: {entry.client_capability_session_id.slice(0, 10)}
            </PtTag>
          )}
          <PtTooltip label={t('chat.queue.cancelAndEdit')}>
            <PtButton
              actionId={`queue-edit-${entry.queue_entry_id}`}
              className="sc-queue__icon"
              data-pt-agent-queue-edit={entry.queue_entry_id}
              emphasis="quiet"
              density="compact"
              leading={<Pencil size={13} />}
              aria-label={t('chat.queue.cancelAndEdit')}
              onActivate={() => {
                void cancelAndEdit(entry.queue_entry_id, entry.user_input);
              }}
            />
          </PtTooltip>
          <PtTooltip label={t('chat.queue.cancel')}>
            <PtButton
              actionId={`queue-cancel-${entry.queue_entry_id}`}
              className="sc-queue__icon"
              data-pt-agent-queue-cancel={entry.queue_entry_id}
              emphasis="quiet"
              density="compact"
              leading={<X size={13} />}
              aria-label={t('chat.queue.cancel')}
              onActivate={() => {
                void cancelQueuedTurn(currentSessionKey, entry.queue_entry_id);
              }}
            />
          </PtTooltip>
        </div>
      ))}
    </div>
  );
}
