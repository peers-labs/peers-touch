import { useMemo, useRef, useState } from 'react';
import { ActionIcon } from '@lobehub/ui';
import { theme } from 'antd';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Compass,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';

import { ChatInput } from '../components/ChatInput';
import { MessageList } from '../components/MessageList';
import { OpStatusTray } from '../components/OpStatusTray';
import { resolveI18nValue } from '../i18n';
import { useAgentStore } from '../store/agent';
import { extractMessageArtifacts, useChatStore } from '../store/chat';

export function ChatPage({ narrow }: { onOpenProfile?: () => void; narrow?: boolean }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const messages = useChatStore((state) => state.messages);
  const sessions = useChatStore((state) => state.sessions);
  const currentSessionKey = useChatStore((state) => state.currentSessionKey);
  const revisionCommandFailure = useChatStore((state) => state.revisionCommandFailure);
  const revisionReloadingConversationId = useChatStore(
    (state) => state.revisionReloadingConversationId,
  );
  const reloadLatestRevision = useChatStore((state) => state.reloadLatestRevision);
  const fillComposer = useChatStore((state) => state.fillComposer);
  const agents = useAgentStore((state) => state.agents);
  const selectedAgent = useAgentStore((state) => state.selectedAgent);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchSessionKey, setSearchSessionKey] = useState(currentSessionKey);
  const searchTriggerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedAgentData = agents.find((agent) => agent.name === selectedAgent);
  const currentSession = sessions.find((session) => session.key === currentSessionKey);
  const topicTitle = resolveI18nValue(currentSession?.title) || t('agent.sidebar.newTopic');
  const contentWidth = narrow
    ? 'calc(100% - 28px)'
    : 'min(720px, calc(100% - 36px))';
  const currentRevisionFailure = revisionCommandFailure?.conversationId === currentSessionKey
    ? revisionCommandFailure
    : null;
  if (searchSessionKey !== currentSessionKey) {
    setSearchSessionKey(currentSessionKey);
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
  }

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return messages.filter((message) => {
      const searchable = [
        message.content,
        ...(message.attachments?.map((attachment) => attachment.filename) ?? []),
        ...extractMessageArtifacts(message).map((artifact) => artifact.title),
      ].join(' ').toLowerCase();
      return searchable.includes(query);
    });
  }, [messages, searchQuery]);
  const visibleSearchIndex = searchResults.length === 0
    ? 0
    : Math.min(searchIndex, searchResults.length - 1);
  const highlightedMessageId = searchResults[visibleSearchIndex]?.id ?? null;

  const moveSearch = (delta: number) => {
    if (searchResults.length === 0) return;
    setSearchIndex((current) => (
      (Math.min(current, searchResults.length - 1) + delta + searchResults.length)
      % searchResults.length
    ));
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setSearchQuery('');
    setSearchIndex(0);
    requestAnimationFrame(() => searchTriggerRef.current?.focus());
  };

  const handleQuickAction = (prompt: string) => {
    fillComposer(prompt);
  };

  if (!selectedAgentData) {
    return (
      <Flexbox
        align="center"
        justify="center"
        style={{ flex: 1, color: token.colorTextTertiary, fontSize: 14 }}
      >
        {t('agent.chat.selectPrompt')}
      </Flexbox>
    );
  }

  const quickActions = [
    t('agent.chat.quickActions.itinerary'),
    t('agent.chat.quickActions.hotels'),
    t('agent.chat.quickActions.experiences'),
    t('agent.chat.quickActions.checklist'),
  ];

  return (
    <div
      data-pt-agent-conversation
      style={{
        minWidth: 0,
        minHeight: 0,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: token.colorBgContainer,
      }}
    >
      <header
        data-pt-agent-conversation-header
        style={{
          height: 52,
          minHeight: 52,
          padding: '0 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <strong
          title={topicTitle}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: token.colorText,
            fontSize: 13,
            fontWeight: 650,
          }}
        >
          {topicTitle}
        </strong>
        {searchOpen ? (
          <div
            role="search"
            aria-label={t('agent.chat.search.open')}
            style={{
              width: narrow ? 'min(300px, 72%)' : 'min(360px, 58%)',
              minWidth: narrow ? 180 : 220,
              height: 34,
              padding: '0 4px 0 9px',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: 8,
              boxSizing: 'border-box',
            }}
          >
            <Search size={13} color={token.colorTextQuaternary} />
            <input
              ref={searchInputRef}
              value={searchQuery}
              aria-label={t('agent.chat.search.placeholder')}
              placeholder={t('agent.chat.search.placeholder')}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeSearch();
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  moveSearch(event.shiftKey ? -1 : 1);
                }
              }}
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                outline: 'none',
                background: 'transparent',
                color: token.colorText,
                font: 'inherit',
                fontSize: 12,
              }}
            />
            <span
              role="status"
              aria-label={t('agent.chat.search.results')}
              style={{
                minWidth: 32,
                color: token.colorTextTertiary,
                fontSize: 10,
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {searchResults.length === 0
                ? '0 / 0'
                : `${visibleSearchIndex + 1} / ${searchResults.length}`}
            </span>
            <ActionIcon
              icon={ChevronUp}
              size={{ blockSize: 24, size: 13 }}
              disabled={searchResults.length === 0}
              title={t('agent.chat.search.previous')}
              onClick={() => moveSearch(-1)}
            />
            <ActionIcon
              icon={ChevronDown}
              size={{ blockSize: 24, size: 13 }}
              disabled={searchResults.length === 0}
              title={t('agent.chat.search.next')}
              onClick={() => moveSearch(1)}
            />
            <ActionIcon
              icon={X}
              size={{ blockSize: 24, size: 13 }}
              title={t('agent.chat.search.close')}
              onClick={closeSearch}
            />
          </div>
        ) : (
          <ActionIcon
            ref={searchTriggerRef}
            icon={Search}
            size={{ blockSize: 32, size: 15 }}
            title={t('agent.chat.search.open')}
            onClick={() => {
              setSearchOpen(true);
              requestAnimationFrame(() => searchInputRef.current?.focus());
            }}
          />
        )}
      </header>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '20px 0',
          boxSizing: 'border-box',
        }}
      >
        {messages.length === 0 ? (
          <Flexbox
            align="center"
            justify="center"
            gap={16}
            style={{
              width: contentWidth,
              minHeight: '100%',
              margin: '0 auto',
              padding: '36px 0',
              boxSizing: 'border-box',
              textAlign: 'center',
            }}
          >
            <div>
              <div style={{ color: token.colorText, fontSize: 18, fontWeight: 700 }}>
                {selectedAgentData.title || selectedAgentData.name}
              </div>
              <div
                style={{
                  maxWidth: 540,
                  marginTop: 8,
                  color: token.colorTextSecondary,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {selectedAgentData.description || t('agent.chat.welcome.fallbackDescription')}
              </div>
            </div>
            <Flexbox horizontal justify="center" gap={8} wrap="wrap">
              {quickActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  onClick={() => handleQuickAction(action)}
                  style={{
                    minHeight: 32,
                    padding: '0 10px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 8,
                    background: token.colorBgContainer,
                    color: token.colorTextSecondary,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  <Compass size={13} />
                  {action}
                </button>
              ))}
            </Flexbox>
          </Flexbox>
        ) : (
          <div style={{ width: contentWidth, margin: '0 auto', boxSizing: 'border-box' }}>
            <MessageList
              scrollRef={scrollRef}
              highlightedMessageId={highlightedMessageId}
            />
          </div>
        )}
      </div>

      <div style={{ width: contentWidth, margin: '0 auto 6px', flexShrink: 0 }}>
        {currentRevisionFailure && (
          <div
            aria-live="polite"
            data-pt-agent-revision-conflict={currentRevisionFailure.resourceId}
            data-pt-agent-revision-error-type={currentRevisionFailure.typedError.error_type}
            data-pt-agent-revision-expected={currentRevisionFailure.expectedRevision}
            data-pt-agent-revision-actual={currentRevisionFailure.actualRevision}
            style={{
              width: '100%',
              minHeight: 36,
              marginBottom: 8,
              padding: '7px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderLeft: `3px solid ${token.colorWarning}`,
              background: token.colorWarningBg,
              color: token.colorWarningText,
              boxSizing: 'border-box',
              fontSize: 12,
            }}
          >
            <AlertTriangle size={15} style={{ flexShrink: 0 }} />
            <span
              data-pt-agent-revision-error-text={
                currentRevisionFailure.typedError.locale_key
              }
              style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}
            >
              {t(currentRevisionFailure.typedError.locale_key)}
            </span>
            <button
              data-pt-agent-revision-reload-latest={currentRevisionFailure.resourceId}
              type="button"
              disabled={revisionReloadingConversationId === currentSessionKey}
              onClick={() => {
                void reloadLatestRevision(currentSessionKey).catch(() => undefined);
              }}
              style={{
                minHeight: 28,
                border: 0,
                borderRadius: 6,
                padding: '3px 7px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: token.colorBgContainer,
                color: token.colorText,
                cursor: revisionReloadingConversationId === currentSessionKey
                  ? 'wait'
                  : 'pointer',
                fontSize: 12,
                fontWeight: 650,
                whiteSpace: 'nowrap',
              }}
            >
              <RefreshCw
                size={13}
                style={{
                  animation: revisionReloadingConversationId === currentSessionKey
                    ? 'spin 1s linear infinite'
                    : undefined,
                }}
              />
              {t(currentRevisionFailure.resolution.label)}
            </button>
          </div>
        )}
        <div style={{ marginBottom: 8 }}>
          <OpStatusTray />
        </div>
      </div>
      <ChatInput />
    </div>
  );
}
