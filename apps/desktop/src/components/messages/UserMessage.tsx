import { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Tag, TextArea } from '@peers-touch/ui';
import type { ChatMessage } from '../../store/chat';
import { useChatStore } from '../../store/chat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { LazyMarkdown as Markdown } from '../LazyMarkdown';
import { MessageActionBar } from '../messages';
import { ForwardMessageModal } from './ForwardMessageModal';
import { MessageAttachments } from './MessageAttachments';
import { useTranslation } from 'react-i18next';
import { timeAgo, fullTime } from './shared';
import { useUserAvatar } from '../UserProfilePopover';
import { notifySuccess } from '../../ui/feedback';

interface UserMessageProps {
  message: ChatMessage;
}

/**
 * Renders a user message including attachments, images, edit mode,
 * markdown content, and the action bar.
 */
export function UserMessage({ message }: UserMessageProps) {
  const { t } = useTranslation('chat');
  // Agent conversations are single-owner (Station enforces ownership via
  // JWT + conversation.actor_ptid), so the session actor is the author of
  // every user message. This is the one identity source; messages carry no
  // author field of their own.
  const user = useUserAvatar();
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [forwardOpen, setForwardOpen] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const branchFromMessage = useChatStore(s => s.branchFromMessage);
  const deleteMessage = useChatStore(s => s.deleteMessage);
  const editMessage = useChatStore(s => s.editMessage);

  useEffect(() => {
    if (editing && editRef.current) {
      const el = editRef.current;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [editing]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      notifySuccess(t('chat.message.toast.copied'));
    });
  }, [message.content, t]);

  const handleBranch = useCallback(() => {
    void branchFromMessage(message.id);
  }, [branchFromMessage, message.id]);

  const handleDelete = useCallback(() => {
    deleteMessage(message.id);
  }, [deleteMessage, message.id]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    setEditing(true);
  }, [message.content]);

  const handleSaveEdit = useCallback(() => {
    if (editContent.trim() !== message.content) {
      editMessage(message.id, editContent.trim());
    }
    setEditing(false);
  }, [editContent, message.content, message.id, editMessage]);

  const handleCancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  return (
    <div
      className={`sc-user-message${hovered ? ' is-hovered' : ''}`}
      data-pt-agent-message="user"
      data-pt-agent-message-id={message.id}
      data-pt-agent-delivery={message.deliveryStatus}
      data-pt-user-actor-ptid={user.ptid}
      id={`agent-message-${message.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header: avatar + name + timestamp. The label stays "You"; the tile
          renders the logged-in actor's real avatar (remote image or name
          initial), resolved from the session identity. */}
      <div className="sc-user-message__head">
        <span title={user.name} className="sc-user-message__avatar">
          <UserSquareAvatar remoteUrl={user.url} name={user.name} size={32} radius={8} />
        </span>
        <strong className="sc-user-message__name">{t('chat.message.you')}</strong>
        <span className="sc-user-message__time" title={fullTime(message.timestamp)}>
          {timeAgo(message.timestamp, t)}
        </span>
        {/* Amended delivery badge: agent message-state contract kept from
            the task-workbench branch; rendered with the peers-ui Tag so the
            north-star shell's antd-free component model stays intact. */}
        {message.deliveryStatus === 'amended' && (
          <Tag
            tone="warning"
            data-pt-agent-delivery-amended
            style={{ margin: 0, fontSize: 11 }}
          >
            {t('chat.delivery.amended')}
          </Tag>
        )}
      </div>

      {/* Message body */}
      <div className="sc-user-message__body">
        <div className={`sc-user-message__bubble${editing ? ' is-editing' : ''}`}>
          {/* Images */}
          {message.images && message.images.length > 0 && (
            <div className="sc-user-message__images">
              {message.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  className="sc-user-message__image"
                  onClick={() => window.open(src, '_blank')}
                />
              ))}
            </div>
          )}

          {/* Non-image attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <MessageAttachments
              attachments={message.attachments}
              marginBottom={Boolean(message.content)}
            />
          )}

          {/* Edit mode / content */}
          {editing ? (
            <div className="sc-user-message__editor">
              <TextArea
                ref={editRef}
                className="sc-user-message__edit-input"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={3}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelEdit();
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEdit();
                }}
              />
              <div className="sc-user-message__edit-actions">
                <Button
                  actionId="user-message-edit-cancel"
                  density="compact"
                  emphasis="secondary"
                  label={t('chat.message.edit.cancel')}
                  onActivate={handleCancelEdit}
                />
                <Button
                  actionId="user-message-edit-save"
                  density="compact"
                  emphasis="primary"
                  label={t('chat.message.edit.save')}
                  onActivate={handleSaveEdit}
                />
              </div>
            </div>
          ) : message.content ? (
            <div className="selectable">
              <Markdown content={message.content} style={{ fontSize: 14 }} />
            </div>
          ) : null}
        </div>

        {/* Audit row */}
        {(message.operation || message.replacementOf || message.replacedBy) && !message.loading && (
          <div className="sc-user-message__audit">
            {message.operation && (
              <span className="sc-tool-tag is-processing">
                {t(`chat.message.audit.${message.operation}`)}
              </span>
            )}
            {message.replacementOf && (
              <span className="sc-tool-tag">{t('chat.message.audit.replacement')}</span>
            )}
            {message.replacedBy && (
              <span className="sc-tool-tag">{t('chat.message.audit.replaced')}</span>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      {!message.loading && !editing && (
        <MessageActionBar
          context={{
            message,
            isStreaming: !!message.loading,
            isCurrentSession: true,
            operation: undefined,
            onCopy: handleCopy,
            onEdit: handleStartEdit,
            onDelete: handleDelete,
            onRegenerate: () => { /* Not applicable for user messages */ },
            onRetry: () => { /* Not applicable for user messages */ },
            onRetryRecovery: () => { /* Not applicable for user messages */ },
            onReloadSnapshot: () => { /* Not applicable for user messages */ },
            onBranch: handleBranch,
            onContinue: () => { /* Not applicable for user messages */ },
            onDeleteAndRegenerate: () => { /* Not applicable for user messages */ },
            onTranslate: () => { /* Not applicable for user messages */ },
            onThread: () => { /* Not applicable for user messages */ },
            onExport: () => { /* Not applicable for user messages */ },
            onForward: () => setForwardOpen(true),
          }}
          style={{
            alignSelf: 'flex-end',
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        />
      )}
      <ForwardMessageModal
        open={forwardOpen}
        messages={[message]}
        onClose={() => setForwardOpen(false)}
      />
    </div>
  );
}
