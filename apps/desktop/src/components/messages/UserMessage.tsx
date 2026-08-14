import { useState, useCallback, useRef, useEffect } from 'react';
import { Flexbox } from 'react-layout-kit';
import { TextArea, Tag, toast } from '@lobehub/ui';
import { theme } from 'antd';
import type { ChatMessage } from '../../store/chat';
import { useChatStore } from '../../store/chat';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { LazyMarkdown as Markdown } from '../LazyMarkdown';
import { chatMarkdownProps } from './markdownConfig';
import { MessageActionBar } from '../messages';
import { MessageAttachments } from './MessageAttachments';
import { useTranslation } from 'react-i18next';
import { timeAgo, fullTime } from './shared';

interface UserMessageProps {
  message: ChatMessage;
  userAvatar?: { url?: string; name: string };
}

/**
 * Renders a user message including attachments, images, edit mode,
 * markdown content, and the action bar.
 */
export function UserMessage({ message, userAvatar }: UserMessageProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const editRef = useRef<{ focus: (options?: { cursor?: string }) => void; blur: () => void; nativeElement: HTMLTextAreaElement } | null>(null);

  const branchFromMessage = useChatStore(s => s.branchFromMessage);
  const deleteMessage = useChatStore(s => s.deleteMessage);
  const editMessage = useChatStore(s => s.editMessage);

  const userDisplayName = userAvatar?.name;

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus({ cursor: 'end' });
    }
  }, [editing]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      toast.success(t('chat.message.toast.copied'));
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
    <Flexbox
      id={`agent-message-${message.id}`}
      align="flex-end"
      gap={8}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        paddingBlock: 8,
        paddingInlineStart: 36,
        paddingInlineEnd: 0,
      }}
    >
      {/* Header: avatar + name + timestamp */}
      <Flexbox direction="horizontal-reverse" align="center" gap={8}>
        <UserSquareAvatar remoteUrl={userAvatar?.url} name={userAvatar?.name} size={32} radius={8} />
        <strong style={{ fontSize: 13, color: token.colorText, fontWeight: 600 }}>
          {userDisplayName || t('chat.message.you')}
        </strong>
        <span
          style={{
            fontSize: 12,
            color: token.colorTextQuaternary,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.2s',
          }}
          title={fullTime(message.timestamp)}
        >
          {timeAgo(message.timestamp, t)}
        </span>
      </Flexbox>

      {/* Message body */}
      <Flexbox
        gap={8}
        style={{
          maxWidth: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            borderRadius: token.borderRadiusLG,
            padding: editing ? 4 : '8px 12px',
            background: token.colorFillTertiary,
            alignSelf: 'flex-end',
          }}
        >
          {/* Images */}
          {message.images && message.images.length > 0 && (
            <Flexbox horizontal gap={8} wrap="wrap" style={{ marginBottom: message.content ? 8 : 0 }}>
              {message.images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt=""
                  style={{
                    maxWidth: 240, maxHeight: 240, borderRadius: 8,
                    objectFit: 'contain', cursor: 'pointer',
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                  onClick={() => window.open(src, '_blank')}
                />
              ))}
            </Flexbox>
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
            <Flexbox gap={8}>
              <TextArea
                ref={editRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                autoSize={{ minRows: 2, maxRows: 12 }}
                style={{ fontSize: 14 }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') handleCancelEdit();
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveEdit();
                }}
              />
              <Flexbox horizontal gap={8} justify="flex-end">
                <button
                  onClick={handleCancelEdit}
                  style={{
                    padding: '4px 12px', borderRadius: 6,
                    border: `1px solid ${token.colorBorder}`,
                    background: token.colorBgContainer,
                    color: token.colorText, cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {t('chat.message.edit.cancel')}
                </button>
                <button
                  onClick={handleSaveEdit}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: 'none',
                    background: token.colorPrimary, color: '#fff',
                    cursor: 'pointer', fontSize: 12,
                  }}
                >
                  {t('chat.message.edit.save')}
                </button>
              </Flexbox>
            </Flexbox>
          ) : message.content ? (
            <div className="selectable">
              <Markdown {...chatMarkdownProps} variant="chat" fontSize={14}>
                {message.content}
              </Markdown>
            </div>
          ) : null}
        </div>

        {/* Audit row */}
        {(message.operation || message.replacementOf || message.replacedBy) && !message.loading && (
          <Flexbox horizontal align="center" gap={4}>
            {message.operation && (
              <Tag bordered={false} color="processing" style={{ margin: 0, fontSize: 11 }}>
                {t(`chat.message.audit.${message.operation}`)}
              </Tag>
            )}
            {message.replacementOf && (
              <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
                {t('chat.message.audit.replacement')}
              </Tag>
            )}
            {message.replacedBy && (
              <Tag bordered={false} style={{ margin: 0, fontSize: 11 }}>
                {t('chat.message.audit.replaced')}
              </Tag>
            )}
          </Flexbox>
        )}
      </Flexbox>

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
            onBranch: handleBranch,
            onContinue: () => { /* Not applicable for user messages */ },
            onDeleteAndRegenerate: () => { /* Not applicable for user messages */ },
            onTranslate: () => { /* Not applicable for user messages */ },
            onThread: () => { /* Not applicable for user messages */ },
            onReadAloud: () => { /* Not applicable for user messages */ },
            onExport: () => { /* Not applicable for user messages */ },
          }}
          style={{
            alignSelf: 'flex-end',
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        />
      )}
    </Flexbox>
  );
}
