import { useEffect, useRef, useState } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, Tag } from '@lobehub/ui';
import { theme } from 'antd';
import { CheckCircle2, Compass, List, Settings2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { ChatInput } from '../components/ChatInput';
import { MessageList } from '../components/MessageList';

export function ChatPage({ onOpenProfile, onToggleTopics, topicsOpen }: { onOpenProfile?: () => void; onToggleTopics?: () => void; topicsOpen?: boolean }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const sessions = useChatStore((s) => s.sessions);
  const selectSession = useChatStore((s) => s.selectSession);
  const loadSessions = useChatStore((s) => s.loadSessions);
  const agents = useAgentStore((s) => s.agents);
  const selectedAgent = useAgentStore((s) => s.selectedAgent);

  const QUICK_ACTIONS = [
    t('agent.chat.quickActions.itinerary'),
    t('agent.chat.quickActions.hotels'),
    t('agent.chat.quickActions.experiences'),
    t('agent.chat.quickActions.checklist'),
  ];

  const selectedAgentData = agents.find((a) => a.name === selectedAgent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < 900 : false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const syncWidth = (width: number) => {
      if (width <= 0) return;
      setIsNarrow(width < 900);
    };
    syncWidth(root.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => syncWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedAgent) return;
    const isTransientKey = !sessions.some((s) => s.key === currentSessionKey);
    if (!isTransientKey) return;
    const existing = sessions.find((s) => s.agent_name === selectedAgent);
    if (existing) {
      selectSession(existing.key);
    }
  }, [currentSessionKey, selectSession, selectedAgent, sessions]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const contentWidth = isNarrow ? 'calc(100% - 28px)' : 'min(620px, calc(100% - 36px))';
  const hasMessages = messages.length > 0;

  const handleQuickAction = (prompt: string) => {
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      nativeInputValueSetter?.call(textarea, prompt);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.focus();
    }
  };

  return (
    <div ref={rootRef} style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0 }}>
      {selectedAgentData ? (
        <>
          <Flexbox
            horizontal
            align="center"
            gap={12}
            style={{
              width: contentWidth,
              margin: '12px auto 0',
              height: 66,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              background: '#fff',
              boxShadow: '0 4px 18px rgba(15,23,42,0.04)',
              padding: '0 14px',
              flexShrink: 0,
              boxSizing: 'border-box',
              minWidth: 0,
            }}
          >
            <AgentIcon name={selectedAgentData.name} avatar={selectedAgentData.avatar} size={40} active token={token} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Flexbox horizontal align="center" gap={8} style={{ minWidth: 0, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 14, fontWeight: 850, color: token.colorText, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedAgentData.name}
                </strong>
                <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11, padding: '2px 7px', fontWeight: 650 }}>
                  {t('agent.chat.tag.agent')}
                </Tag>
                <Tag style={{ margin: 0, borderRadius: 999, fontSize: 11, padding: '2px 7px', fontWeight: 650 }}>
                  {t('agent.chat.tag.station')}
                </Tag>
              </Flexbox>
              <div style={{ marginTop: 4, color: token.colorTextSecondary, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {selectedAgentData.description || t('agent.chat.welcome.fallbackDescription')}
              </div>
            </div>
            {isNarrow ? (
              <ActionIcon
                icon={List}
                title={topicsOpen ? t('agent.chat.topics.collapse') : t('agent.chat.topics.expand')}
                size={{ blockSize: 28, size: 15 }}
                onClick={onToggleTopics}
                style={{
                  flexShrink: 0,
                  borderRadius: 8,
                  background: topicsOpen ? '#eceaf6' : token.colorFillQuaternary,
                  color: topicsOpen ? token.colorPrimary : token.colorTextSecondary,
                  border: 0,
                }}
              />
            ) : (
              <button
                type="button"
                title={t('agent.list.agentSettings')}
                onClick={onOpenProfile}
                style={{ border: 0, background: 'transparent', color: token.colorTextTertiary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', borderRadius: 6 }}
              >
                <Settings2 size={15} />
              </button>
            )}
          </Flexbox>

          <div
            ref={scrollRef}
            style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '20px 0 20px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
          >
            {!hasMessages ? (
              <>
                <div
                  style={{
                    width: contentWidth,
                    minHeight: 232,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 14,
                    background: '#fff',
                    boxShadow: '0 8px 28px rgba(15,23,42,0.05)',
                    padding: '24px 32px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  <AgentIcon name={selectedAgentData.name} avatar={selectedAgentData.avatar} size={48} active token={token} />
                  <div style={{ marginTop: 10, fontSize: 17, fontWeight: 800, color: token.colorText }}>{selectedAgentData.name}</div>
                  <Flexbox horizontal align="center" gap={10} style={{ marginTop: 10, minHeight: 26, borderRadius: 8, background: token.colorFillQuaternary, padding: '0 10px', color: token.colorTextTertiary, fontSize: 11 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: token.colorSuccess }}>
                      <CheckCircle2 size={13} /> {t('agent.chat.welcome.toolsEnabled')}
                    </span>
                    <span>{t('agent.chat.tag.station')}</span>
                    <span>{t('agent.chat.welcome.memory')}</span>
                  </Flexbox>
                  <p style={{ maxWidth: 440, margin: '14px 0 12px', color: token.colorTextSecondary, fontSize: 13, lineHeight: 1.6 }}>
                    {selectedAgentData.systemPrompt || t('agent.chat.welcome.fallbackGreeting', { name: selectedAgentData.name })}
                  </p>
                  <Tag style={{ margin: 0, borderRadius: 6, fontSize: 11, padding: '4px 10px', background: token.colorFillQuaternary, color: token.colorTextTertiary, border: 0, fontWeight: 650 }}>
                    {t('agent.chat.welcome.agentReady')}
                  </Tag>
                </div>

                <Flexbox horizontal gap="6px 16px" wrap="wrap" justify="center" style={{ width: contentWidth, padding: '0 12px' }}>
                  {QUICK_ACTIONS.map((action) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => handleQuickAction(action)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        border: 0,
                        background: 'transparent',
                        color: token.colorText,
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      <Compass size={13} />
                      {action}
                    </button>
                  ))}
                </Flexbox>
              </>
            ) : (
              <div style={{ width: contentWidth, boxSizing: 'border-box' }}>
                <MessageList />
              </div>
            )}
          </div>

          <div style={{ width: contentWidth, margin: '0 auto 18px', flexShrink: 0 }}>
            <ChatInput />
          </div>
        </>
      ) : (
        <Flexbox style={{ flex: 1, alignItems: 'center', justifyContent: 'center', color: token.colorTextTertiary, fontSize: 14 }}>
          {t('agent.chat.selectPrompt')}
        </Flexbox>
      )}
    </div>
  );
}

function AgentIcon({ name, avatar, size, active, token }: { name: string; avatar?: string; size: number; active?: boolean; token: any }) {
  const iconSize = Math.max(14, Math.round(size * 0.48));
  const borderRadius = Math.max(8, size / 4);
  const initial = name.charAt(0).toUpperCase();
  const isUrl = avatar && /^(https?:|\/|asset|file:)/.test(avatar);
  const isEmoji = avatar && !isUrl && avatar.length <= 4;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius,
        background: active ? token.colorPrimaryBg : token.colorFillQuaternary,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        fontSize: size > 36 ? 20 : 13,
        color: active ? token.colorPrimary : token.colorTextSecondary,
        overflow: 'hidden',
      }}
    >
      {isUrl ? (
        <img src={avatar} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius }} />
      ) : isEmoji ? (
        <span style={{ fontSize: iconSize * 1.2, lineHeight: 1 }}>{avatar}</span>
      ) : avatar ? (
        <span style={{ fontSize: iconSize, fontWeight: 700 }}>{avatar}</span>
      ) : (
        <span style={{ fontSize: iconSize, fontWeight: 700 }}>{initial}</span>
      )}
    </span>
  );
}
