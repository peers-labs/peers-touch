import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, Empty as PtEmpty, TextField as PtTextField } from '@peers-touch/ui';
import { Search } from 'lucide-react';

import type { DesktopIMConversationProjection } from '../../store/socialProjection';

interface ForwardPickerModalProps {
  conversations: DesktopIMConversationProjection[];
  onCancel: () => void;
  onSelect: (conversation: DesktopIMConversationProjection) => void;
  open: boolean;
}

export function ForwardPickerModal({
  conversations,
  onCancel,
  onSelect,
  open,
}: ForwardPickerModalProps) {
  const { t } = useTranslation('chat');
  const [filter, setFilter] = useState('');

  const filtered = filter.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(filter.toLowerCase()),
      )
    : conversations;

  return (
    <Dialog
      open={open}
      onDismiss={onCancel}
      title={t('chat.social.messageArea.forwardTitle')}
      width={360}
      closeLabel={t('chat.social.messageArea.cancel')}
    >
      <div className="sc-forward">
        <PtTextField
          leading={<Search size={14} />}
          clearable
          onClear={() => setFilter('')}
          placeholder={t('chat.social.messageArea.forwardTitle')}
          value={filter}
          onValueChange={setFilter}
          aria-label={t('chat.social.messageArea.forwardTitle')}
          data-forward-search
        />
        <div className="sc-forward__list">
          {filtered.length === 0 ? (
            <PtEmpty
              description={t('chat.social.messageArea.forwardEmpty')}
            />
          ) : (
            filtered.map((conv) => (
              <button
                type="button"
                key={conv.id}
                className="sc-forward__row"
                onClick={() => onSelect(conv)}
                data-forward-conversation={conv.id}
              >
                <span className="sc-forward__avatar">
                  {conv.title.charAt(0).toUpperCase()}
                </span>
                <span className="sc-forward__body">
                  <strong>{conv.title}</strong>
                  <span>
                    {conv.kind === 'group'
                      ? t('chat.social.messageArea.forwardKindGroup', { count: conv.memberCount ?? 0 })
                      : t('chat.social.messageArea.forwardKindDirect')}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
