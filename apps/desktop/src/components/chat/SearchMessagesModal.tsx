import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Input } from '@lobehub/ui';
import { Modal, Typography, Spin, Empty, theme } from 'antd';
import { Search, MessageSquare, Users } from 'lucide-react';
import { useSocialChatStore } from '../../store/socialChat';
import type { SearchResult } from '../../store/socialChat';
import { log } from '../../utils/logger';

const { Text } = Typography;

function formatSentAt(epochSec: number, t: (key: string, opts?: { count?: number }) => string): string {
  const d = new Date(epochSec * 1000);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return t('chat.social.time.justNow');
  if (minutes < 60) return t('chat.social.time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('chat.social.time.hoursAgo', { count: hours });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function highlightMatch(content: string, query: string, warningBg: string): ReactNode {
  if (!query.trim()) return content;
  const lower = content.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) {
    return content.length > 120 ? `${content.slice(0, 120)}…` : content;
  }
  const start = Math.max(0, idx - 30);
  const prefix = start > 0 ? '…' : '';
  const before = content.slice(start, idx);
  const match = content.slice(idx, idx + query.length);
  const afterRaw = content.slice(idx + query.length);
  const after = afterRaw.length > 60 ? `${afterRaw.slice(0, 60)}…` : afterRaw;
  return (
    <>
      {prefix}
      {before}
      <span style={{ backgroundColor: warningBg, fontWeight: 600 }}>{match}</span>
      {after}
    </>
  );
}

export interface SearchMessagesModalProps {
  open: boolean;
  onClose: () => void;
  /** Limit search to friend or group scope; omit to search both. */
  initialScope?: string;
  /** Limit search to this conversation ULID (session or group). */
  conversationId?: string;
}

export function SearchMessagesModal({
  open,
  onClose,
  initialScope,
  conversationId,
}: SearchMessagesModalProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const [localQuery, setLocalQuery] = useState('');
  const {
    searchQuery,
    searchResults,
    searchLoading,
    searchMessages,
    clearSearch,
    selectSession,
    selectGroup,
    setActiveTab,
    setScrollToMessageUlid,
  } = useSocialChatStore();

  useEffect(() => {
    if (!open) return;
    setLocalQuery('');
    clearSearch();
  }, [open, clearSearch]);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      void searchMessages(localQuery.trim(), initialScope, conversationId).catch((err) => {
        log.error('SearchMessagesModal', 'searchMessages', err);
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [localQuery, open, initialScope, conversationId, searchMessages]);

  const handleClose = useCallback(() => {
    clearSearch();
    setLocalQuery('');
    onClose();
  }, [clearSearch, onClose]);

  const handleResultClick = useCallback(
    (result: SearchResult) => {
      setScrollToMessageUlid(result.messageId);
      if (result.scope === 'friend') {
        selectSession(result.conversationId);
        setActiveTab('friend');
      } else {
        selectGroup(result.conversationId);
        setActiveTab('group');
      }
      handleClose();
    },
    [selectSession, selectGroup, setActiveTab, setScrollToMessageUlid, handleClose],
  );

  const scopeLabel = (r: SearchResult) =>
    t('chat.social.search.inConversation', { name: r.conversationName });

  return (
    <Modal
      title={
        <Flexbox horizontal align="center" gap={8}>
          <Search size={18} />
          {t('chat.social.search.title')}
        </Flexbox>
      }
      open={open}
      onCancel={handleClose}
      footer={null}
      width={560}
      destroyOnClose
    >
      <Flexbox gap={12}>
        <Input
          allowClear
          prefix={<Search size={16} style={{ color: token.colorTextQuaternary }} />}
          placeholder={t('chat.social.search.placeholder')}
          value={localQuery}
          onChange={(e) => setLocalQuery(e.target.value)}
        />
        {searchLoading ? (
          <Flexbox align="center" justify="center" style={{ minHeight: 200 }}>
            <Spin />
          </Flexbox>
        ) : searchQuery.trim() && searchResults.length === 0 ? (
          <Empty description={t('chat.social.search.noResults')} />
        ) : (
          <>
            {searchResults.length > 0 && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t('chat.social.search.resultCount', { count: searchResults.length })}
              </Text>
            )}
            <Flexbox
              gap={0}
              style={{
                maxHeight: 360,
                overflow: 'auto',
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: token.borderRadius,
              }}
            >
              {searchResults.map((r) => (
                <Flexbox
                  key={`${r.scope}-${r.conversationId}-${r.messageId}`}
                  horizontal
                  align="flex-start"
                  gap={10}
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  }}
                  onClick={() => handleResultClick(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleResultClick(r);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <Flexbox
                    align="center"
                    justify="center"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: token.colorFillTertiary,
                      flexShrink: 0,
                      color: token.colorTextSecondary,
                    }}
                  >
                    {r.scope === 'friend' ? <MessageSquare size={16} /> : <Users size={16} />}
                  </Flexbox>
                  <Flexbox style={{ minWidth: 0, flex: 1 }} gap={4}>
                    <Text strong ellipsis style={{ fontSize: 13 }}>
                      {r.conversationName}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {scopeLabel(r)}
                    </Text>
                    <Text style={{ fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word' }}>
                      {highlightMatch(r.content, searchQuery, token.colorWarningBg)}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {formatSentAt(r.sentAt, t)}
                    </Text>
                  </Flexbox>
                </Flexbox>
              ))}
            </Flexbox>
          </>
        )}
      </Flexbox>
    </Modal>
  );
}
