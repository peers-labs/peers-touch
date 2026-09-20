import { useRef } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Tag } from '@lobehub/ui';
import { theme } from 'antd';
import {
  AlertTriangle,
  CheckCircle2,
  Compass,
  PanelRight,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { usePortalStore } from '../store/portal';
import { ChatInput } from '../components/ChatInput';
import { MessageList } from '../components/MessageList';
import { OpStatusTray } from '../components/OpStatusTray';
import { InterventionBar } from '../components/chat/InterventionBar';
import { ChatTerminalPanel } from '../components/chat/ChatTerminalPanel';
import { TerminalToggleButton } from '../components/chat/TerminalToggleButton';
import { TurnQueueTray } from '../components/chat/TurnQueueTray';

export function ChatPage({ onOpenProfile, narrow }: { onOpenProfile?: () => void; narrow?: boolean }) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();
  const messages = useChatStore((s) => s.messages);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const revisionCommandFailure = useChatStore((s) => s.revisionCommandFailure);
  const revisionReloadingConversationId = useChatStore(
    (s) => s.revisionReloadingConversationId,
  );
  const reloadLatestRevision = useChatStore((s) => s.reloadLatestRevision);
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
  const isNarrow = narrow ?? false;

  const contentWidth = isNarrow ? 'calc(100% - 28px)' : 'min(620px, calc(100% - 36px))';
  const hasMessages = messages.length > 0;
  const currentRevisionFailure = (
    revisionCommandFailure?.conversationId === currentSessionKey
      ? revisionCommandFailure
      : null
  );

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
    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0 }}>
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
            <Flexbox horizontal align="center" gap={6} style={{ flexShrink: 0 }}>
              <TerminalToggleButton />
              {!isNarrow && (
                <button
                  type="button"
                  title={t('agent.list.agentSettings')}
                  onClick={onOpenProfile}
                  style={{ border: 0, background: 'transparent', color: token.colorTextTertiary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', borderRadius: 6 }}
                >
                  <Settings2 size={15} />
                </button>
              )}
              {!isNarrow && (
                <button
                  data-pt-agent-portal-toggle
                  type="button"
                  title={t('agent.portal.toggle')}
                  onClick={() => usePortalStore.getState().toggle()}
                  style={{ border: 0, background: 'transparent', color: token.colorTextTertiary, cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center', borderRadius: 6 }}
                >
                  <PanelRight size={15} />
                </button>
              )}
            </Flexbox>
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
                <MessageList scrollRef={scrollRef} />
              </div>
            )}
          </div>

          <div style={{ width: contentWidth, margin: '0 auto 18px', flexShrink: 0 }}>
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
                  data-pt-agent-revision-error-text={currentRevisionFailure.typedError.locale_key}
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
                    minHeight: 26,
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
                      flexShrink: 0,
                      animation: revisionReloadingConversationId === currentSessionKey
                        ? 'spin 1s linear infinite'
                        : undefined,
                    }}
                  />
                  {t(currentRevisionFailure.resolution.label)}
                </button>
              </div>
            )}
            <TurnQueueTray />
            <div style={{ marginBottom: 8 }}>
              <OpStatusTray />
            </div>
            <InterventionBar />
            <ChatInput />
            <ChatTerminalPanel />
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
