import { Button, Spin, Typography } from 'antd';
import { useMobileI18n } from '../../app/mobileI18n';
import { BoundedList } from '../../components/BoundedList';
import { MobileAvatar } from '../../components/MobileAvatar';
import { MobileNotice } from '../../components/MobileNotice';
import { conversationTitle, formatRelativeTime, messageDisplayText, messageTimestampMillis } from '../../features/chat/chatSelectors';
import type { GlobalChatMessageResult } from '../../features/chat/useGlobalChatSearch';
import type { SocialContact } from '../../features/social/socialProjection';
import './global-chat-search.css';

export function GlobalChatSearchResults({
  query, contacts, results, loading, failed, submitted, index, hasNext,
  onOpenContact, onOpenMessage, onRetry, onPrevious, onNext,
  resolveAuthor,
}: {
  readonly query: string;
  readonly contacts: readonly SocialContact[];
  readonly results: readonly GlobalChatMessageResult[];
  readonly loading: boolean;
  readonly failed: boolean;
  readonly submitted: boolean;
  readonly index: number;
  readonly hasNext: boolean;
  readonly onOpenContact: (ptid: string) => void;
  readonly onOpenMessage: (result: GlobalChatMessageResult) => void;
  readonly onRetry: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly resolveAuthor: (result: GlobalChatMessageResult) => string;
}) {
  const { t } = useMobileI18n();
  const sourceLabel = (result: GlobalChatMessageResult) => {
    const conversation = conversationTitle(result.conversation);
    const author = resolveAuthor(result);
    return author && author !== conversation ? `${conversation} · ${author}` : conversation;
  };
  if (!query.trim()) return null;
  return (
    <div className="global-chat-search-results" data-product-surface="chat.global-search">
      <section aria-label={t('mobile.chat.search.contacts')}>
        <h2>{t('mobile.chat.search.contacts')}</h2>
        <BoundedList surfaceKey={`global-contacts:${query}`} items={[...contacts]} itemKey={(contact) => contact.peerPtid}>
          {(rows) => rows.map((contact) => (
            <button type="button" className="global-chat-contact-result" key={contact.peerPtid}
              onClick={() => onOpenContact(contact.peerPtid)}>
              <MobileAvatar src={contact.peerAvatar} name={contact.peerName} identityKey={contact.peerPtid} size={32} />
              <span>{contact.peerName}</span>
            </button>
          ))}
        </BoundedList>
        {!contacts.length ? <Typography.Text type="secondary">{t('mobile.contacts.noSearchResults')}</Typography.Text> : null}
      </section>
      <section aria-label={t('mobile.chat.search.messages')}>
        <h2>{t('mobile.chat.search.messages')}</h2>
        {loading ? <Spin /> : failed ? (
          <MobileNotice tone="error">
            {t('mobile.chat.searchFailed')}
            <Button onClick={onRetry}>{t('common.action.retry')}</Button>
          </MobileNotice>
        ) : !submitted ? (
          <Typography.Text type="secondary">{t('mobile.chat.search.submitHint')}</Typography.Text>
        ) : results.length ? (
          <BoundedList surfaceKey={`global-messages:${query}:${index}`} items={[...results]}
            itemKey={(result) => `${result.conversation.key}:${result.message.ulid}`}>
            {(rows) => rows.map((result) => (
              <button type="button" className="message-search-result"
                data-search-message-id={result.message.ulid} key={`${result.conversation.key}:${result.message.ulid}`}
                onClick={() => onOpenMessage(result)}>
                <Typography.Text strong ellipsis>
                  {sourceLabel(result)}
                </Typography.Text>
                <Typography.Text ellipsis>{messageDisplayText(result.message, t)}</Typography.Text>
                <Typography.Text type="secondary">{formatRelativeTime(messageTimestampMillis(result.message), t)}</Typography.Text>
              </button>
            ))}
          </BoundedList>
        ) : <Typography.Text type="secondary">{t('mobile.chat.noMessageResults')}</Typography.Text>}
        {!loading && submitted ? (
          <div className="bounded-list-controls">
            {index > 0 ? <Button onClick={onPrevious}>{t('mobile.list.previous')}</Button> : null}
            {hasNext ? <Button onClick={onNext}>{t('mobile.list.next')}</Button> : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
