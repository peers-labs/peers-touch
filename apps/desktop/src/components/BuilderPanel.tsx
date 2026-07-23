import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { Flexbox, Center } from 'react-layout-kit';
import { ActionIcon, DraggablePanel } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { theme, Select, Popover } from 'antd';
import {
  PanelRightClose,
  PanelRightOpen,
  Send,
  Square,
  ChevronDown,
  PencilLine,
  Image as ImageIcon,
} from 'lucide-react';
import { useChatStore, type ChatMessage } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { MessageBubble } from './MessageBubble';
import { ModelProviderSelect } from './ModelProviderSelect';
import { executeAgentTurn, type Agent, type Session } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';
import { useTranslation } from 'react-i18next';
import { AgentIconTile } from './agent/AgentIconTile';

export interface BuilderPanelProps {
  agentName: string;
  scope: string;
  welcomeTitle: string;
  welcomeDescription: string;
  welcomeAvatar?: string;
  suggestQuestions?: string[];
  contextSummary?: Array<{ label: string; value: string; ready?: boolean; targetTab?: string }>;
  onContextItemClick?: (targetTab: string) => void;
  contextPayload?: Record<string, unknown>;
  expand: boolean;
  onExpandChange: (v: boolean) => void;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  showAgentSelector?: boolean;
  showTopicSelector?: boolean;
  onDocumentUpdated?: (docId: string) => void;
  disabled?: boolean;
  disabledMessage?: string;
}

function buildScopedBuilderRequest(text: string, contextPayload?: Record<string, unknown>) {
  if (!contextPayload || Object.keys(contextPayload).length === 0) return text;
  return [
    'Use the following structured workspace context before answering.',
    'Return concrete configuration suggestions and mention which checklist item they advance.',
    '',
    '```json',
    JSON.stringify(contextPayload, null, 2),
    '```',
    '',
    'User request:',
    text,
  ].join('\n');
}

function AgentSelector({
  agents,
  selectedAgentName,
  onSelect,
}: {
  agents: Agent[];
  selectedAgentName: string;
  onSelect: (name: string) => void;
}) {
  const { token } = theme.useToken();
  const selected = agents.find((a) => a.name === selectedAgentName);
  return (
    <Select
      size="small"
      value={selectedAgentName}
      onChange={onSelect}
      popupMatchSelectWidth={200}
      style={{ minWidth: 110 }}
      variant="borderless"
      labelRender={() => (
        <Flexbox horizontal align="center" gap={4}>
          <AgentIconTile agent={selected} size={20} subtle />
          <span style={{ fontSize: 12, fontWeight: 500, color: token.colorText }}>
            {selected?.title || selected?.name || selectedAgentName}
          </span>
        </Flexbox>
      )}
      options={agents.map((a) => ({
        value: a.name,
        label: (
          <Flexbox horizontal align="center" gap={6}>
            <AgentIconTile agent={a} size={22} subtle />
            <span style={{ fontSize: 13 }}>{a.title || a.name}</span>
          </Flexbox>
        ),
      }))}
    />
  );
}

export function BuilderPanel({
  agentName,
  scope,
  welcomeTitle,
  welcomeDescription,
  suggestQuestions,
  contextSummary,
  onContextItemClick,
  contextPayload,
  expand,
  onExpandChange,
  defaultWidth = 400,
  minWidth = 320,
  maxWidth = 560,
  showAgentSelector = false,
  showTopicSelector = false,
  disabled = false,
  disabledMessage,
}: BuilderPanelProps) {
  const { t } = useTranslation('agent');
  const { token } = theme.useToken();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState<number | undefined>();

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const ro = new ResizeObserver(([entry]) => {
      setPanelHeight(entry.contentRect.height);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [expand]);

  const [currentAgent, setCurrentAgent] = useState(agentName);
  const [modelOpen, setModelOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState('');
  const isComposingRef = useRef(false);

  const agents = useAgentStore(s => s.agents);
  const defaultModel = useAgentStore(s => s.defaultModel);
  const selectedModel = useAgentStore(s => s.selectedModel);
  const selectedProviderId = useAgentStore(s => s.selectedProviderId);
  const availableModels = useAgentStore(s => s.availableModels);
  const setSelectedModel = useAgentStore(s => s.setSelectedModel);
  const sessions = useChatStore(s => s.sessions);

  const currentModelId = selectedModel || defaultModel;
  const currentModelLabel = useMemo(() => {
    const model = availableModels.find((item) => item.id === currentModelId);
    return model?.display_name || currentModelId || t('agent.builder.context.model');
  }, [availableModels, currentModelId, t]);

  const scopedSessionKey = useMemo(() => {
    return sessionKey || `${scope}:${currentAgent}`;
  }, [sessionKey, scope, currentAgent]);

  useEffect(() => {
    setCurrentAgent(agentName);
  }, [agentName]);

  const topicOptions = useMemo(() => {
    if (!showTopicSelector) return [];
    return sessions.filter((s: Session) => s.message_count > 0);
  }, [sessions, showTopicSelector]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || disabled) return;

    const now = Date.now();
    const userMsg: ChatMessage = { id: `u-${now}`, role: 'user', content: text, timestamp: now };
    const assistantId = `a-${now}`;
    const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: '', loading: true, timestamp: now };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setLoading(true);

    const modelOverride = selectedModel && selectedModel !== defaultModel ? selectedModel : undefined;
    let assistantContent = '';
    let modelName = modelOverride || '';
    const controller = executeAgentTurn(
      buildScopedBuilderRequest(text, contextPayload),
      scopedSessionKey,
      currentAgent,
      (event) => {
        if (event.event === 'text') {
          const delta = event.data?.content || '';
          if (delta) assistantContent += delta;
        }
        if (event.event === 'done') {
          modelName = event.data?.model || modelName;
        }
      },
      () => {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: assistantContent, loading: false, model: modelName || undefined } : m)),
        );
        eventBus.publish(EVENT.AGENT_BUILDER_STREAM_ENDED, undefined);
        setLoading(false);
        abortRef.current = null;
      },
      (err) => {
        if (err.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: t('agent.builder.error', { error: err.message }), loading: false } : m)),
          );
        }
        setLoading(false);
        abortRef.current = null;
      },
      undefined,
      modelOverride,
      selectedProviderId || undefined,
    );
    abortRef.current = controller;
  }, [input, loading, disabled, scopedSessionKey, currentAgent, contextPayload, selectedModel, defaultModel, selectedProviderId]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSuggestClick = useCallback((q: string) => {
    setInput(q);
  }, []);

  if (!expand) {
    return (
      <aside
        style={{
          width: 40,
          height: '100%',
          flexShrink: 0,
          borderLeft: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          flexDirection: 'column',
          position: 'relative',
          paddingTop: 17,
          boxSizing: 'border-box',
        }}
      >
        <ActionIcon
          icon={PanelRightOpen}
          size="small"
          title={t('agent.builder.expand')}
          onClick={() => onExpandChange(true)}
          style={{ border: 0, boxShadow: 'none' }}
        />
        <span
          style={{
            position: 'absolute',
            inset: '58px 0 58px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            color: token.colorTextSecondary,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.4,
            pointerEvents: 'none',
          }}
        >
          {welcomeTitle}
        </span>
      </aside>
    );
  }

  return (
    <DraggablePanel
      placement="right"
      defaultSize={{ width: defaultWidth }}
      minWidth={minWidth}
      maxWidth={maxWidth}
      expand={expand}
      onExpandChange={onExpandChange}
    >
      <div
        ref={contentRef}
        style={{
          height: panelHeight ?? '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: token.colorBgContainer,
        }}
      >
        {/* Header */}
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{
            padding: '0 14px',
            borderBottom: showTopicSelector ? 'none' : `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            flexShrink: 0,
            height: 48,
            minHeight: 48,
          }}
        >
          {showAgentSelector ? (
            <AgentSelector agents={agents} selectedAgentName={currentAgent} onSelect={setCurrentAgent} />
          ) : (
            <Flexbox horizontal align="center" gap={6}>
              <AgentIconTile agent={{ name: welcomeTitle, description: welcomeDescription }} size={24} subtle />
              <span style={{ fontSize: 14, fontWeight: 700, color: token.colorText }}>{welcomeTitle}</span>
            </Flexbox>
          )}
          <ActionIcon icon={PanelRightClose} size="small" onClick={() => onExpandChange(false)} />
        </Flexbox>
        {showTopicSelector && (
          <Flexbox
            horizontal
            align="center"
            style={{
              padding: '0 12px 8px',
              borderBottom: `1px solid ${token.colorBorderSecondary}`,
              background: token.colorBgContainer,
              flexShrink: 0,
            }}
          >
            <Select
              size="small"
              value={scopedSessionKey}
              onChange={(val) => {
                setSessionKey(val);
                setMessages([]);
              }}
              popupMatchSelectWidth={280}
              style={{ flex: 1, minWidth: 0 }}
              variant="borderless"
              placeholder={t('agent.builder.selectTopic')}
              allowClear
              onClear={() => {
                setSessionKey('');
                setMessages([]);
              }}
              options={[
                { value: `${scope}:${currentAgent}`, label: t('agent.builder.defaultTopic') },
                ...topicOptions.map((s: Session) => ({
                  value: s.key,
                  label: `# ${s.title || s.key}`,
                })),
              ]}
              showSearch
              filterOption={(inp, option) =>
                (option?.label as string)?.toLowerCase().includes(inp.toLowerCase()) ?? false
              }
            />
          </Flexbox>
        )}

        {/* Messages */}
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, width: '100%', padding: '0 14px 24px' }}>
          {messages.length === 0 ? (
            <Center style={{ height: '100%', padding: '24px 4px' }}>
              <Flexbox align="center" gap={12} style={{ width: '100%' }}>
                <AgentIconTile agent={{ name: welcomeTitle, description: welcomeDescription }} size={54} />
                <span style={{ fontSize: 15, fontWeight: 750, color: token.colorText }}>
                  {welcomeTitle}
                </span>
                <span style={{ fontSize: 12, color: token.colorTextDescription, textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
                  {welcomeDescription}
                </span>
                {contextSummary && contextSummary.length > 0 && (
                  <Flexbox gap={6} style={{ width: '100%', maxWidth: 320 }}>
                    {contextSummary.map((item) => {
                      const clickable = Boolean(item.targetTab && onContextItemClick);
                      return (
                        <Flexbox
                          key={`${item.label}:${item.value}`}
                          horizontal
                          align="center"
                          justify="space-between"
                          gap={8}
                          onClick={
                            clickable
                              ? () => onContextItemClick?.(item.targetTab as string)
                              : undefined
                          }
                          style={{
                            padding: '8px 10px',
                            borderRadius: 10,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            background: item.ready ? token.colorSuccessBg : token.colorWarningBg,
                            cursor: clickable ? 'pointer' : 'default',
                          }}
                        >
                          <span style={{ fontSize: 12, color: token.colorTextSecondary }}>
                            {item.label}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: token.colorText,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.value}
                          </span>
                        </Flexbox>
                      );
                    })}
                  </Flexbox>
                )}
                {suggestQuestions && suggestQuestions.length > 0 && (
                  <Flexbox gap={6} style={{ marginTop: 8, width: '100%', maxWidth: 300 }}>
                    {suggestQuestions.map((q) => (
                      <div
                        key={q}
                        onClick={() => handleSuggestClick(q)}
                        style={{
                          padding: '9px 12px',
                          borderRadius: 10,
                          border: `1px solid ${token.colorBorderSecondary}`,
                          background: token.colorBgContainer,
                          fontSize: 13,
                          color: token.colorText,
                          cursor: 'pointer',
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorBgContainer; }}
                      >
                        {q}
                      </div>
                    ))}
                  </Flexbox>
                )}
              </Flexbox>
            </Center>
          ) : (
            <>
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </>
          )}
          <div ref={endRef} />
        </div>

        {/* Input area */}
        <Flexbox style={{ padding: '0 14px 24px', flexShrink: 0 }}>
          <Flexbox
            style={{
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorder}`,
              borderRadius: 24,
              overflow: 'hidden',
              boxShadow: '0 18px 60px rgba(15, 23, 42, 0.07)',
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onCompositionStart={() => { isComposingRef.current = true; }}
              onCompositionEnd={() => { isComposingRef.current = false; }}
              onKeyDown={(e) => {
                const native = e.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
                if (e.key === 'Enter' && !e.shiftKey && !isComposingRef.current && !native.isComposing && native.keyCode !== 229) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={disabled}
              placeholder={disabled ? (disabledMessage || t('agent.builder.disabled')) : t('agent.builder.placeholder')}
              rows={4}
              style={{
                width: '100%',
                resize: 'none',
                border: 'none',
                borderRadius: 0,
                padding: '20px 22px 12px',
                fontSize: 15,
                lineHeight: 1.6,
                outline: 'none',
                fontFamily: 'inherit',
                background: 'transparent',
                color: token.colorText,
                minHeight: 116,
                maxHeight: 160,
                overflow: 'auto',
              }}
            />
            <Flexbox horizontal align="center" justify="space-between" gap={10} style={{ padding: '0 14px 14px' }}>
              <Flexbox horizontal align="center" gap={8} style={{ flexShrink: 0 }}>
                <ActionIcon
                  icon={PencilLine}
                  size="large"
                  disabled
                  title={t('agent.builder.composeModeActive')}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    color: token.colorTextSecondary,
                    cursor: 'default',
                  }}
                />
                <ActionIcon
                  icon={ImageIcon}
                  size="large"
                  disabled
                  title={t('agent.builder.attachImageUnavailable')}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: 19,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    background: token.colorBgContainer,
                    color: token.colorTextSecondary,
                    cursor: 'not-allowed',
                  }}
                />
              </Flexbox>
              <Flexbox horizontal align="center" justify="center" gap={2} style={{ minWidth: 0, flex: 1 }}>
                <Popover
                  open={modelOpen}
                  onOpenChange={setModelOpen}
                  placement="topLeft"
                  trigger="click"
                  content={
                    <ModelProviderSelect
                      selectedModelId={currentModelId}
                      onSelect={(id, pid) => {
                        setSelectedModel(id, pid);
                        setModelOpen(false);
                      }}
                      onClose={() => setModelOpen(false)}
                    />
                  }
                  styles={{ content: { padding: 0, minWidth: 280, maxWidth: 360 } }}
                >
                  <button
                    type="button"
                    title={currentModelLabel}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      maxWidth: '100%',
                      height: 38,
                      padding: '0 14px',
                      border: 0,
                      borderRadius: 19,
                      cursor: 'pointer',
                      background: token.colorFillQuaternary,
                      color: token.colorText,
                      fontSize: 13,
                      fontWeight: 650,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillQuaternary; }}
                  >
                    <ModelIcon model={currentModelId} size={16} />
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {currentModelLabel}
                    </span>
                    <ChevronDown size={13} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
                  </button>
                </Popover>
              </Flexbox>
              <Flexbox horizontal align="center" gap={4} style={{ flexShrink: 0 }}>
                {loading ? (
                  <ActionIcon
                    icon={Square}
                    size="large"
                    onClick={handleStop}
                    title={t('common.action.stop', { ns: 'common' })}
                    style={{
                      width: 42,
                      height: 42,
                      background: token.colorError,
                      color: '#fff',
                      borderRadius: 21,
                    }}
                  />
                ) : (
                  <ActionIcon
                    icon={Send}
                    size="large"
                    onClick={handleSend}
                    disabled={!input.trim()}
                    title={t('common.action.send', { ns: 'common' })}
                    style={{
                      width: 42,
                      height: 42,
                      background: input.trim() ? token.colorPrimary : token.colorFillSecondary,
                      color: input.trim() ? '#fff' : token.colorTextQuaternary,
                      borderRadius: 21,
                    }}
                  />
                )}
              </Flexbox>
            </Flexbox>
          </Flexbox>
        </Flexbox>
      </div>
    </DraggablePanel>
  );
}
