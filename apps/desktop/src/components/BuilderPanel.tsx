import { useState, useCallback, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { Flexbox, Center } from 'react-layout-kit';
import { ActionIcon, Avatar, DraggablePanel } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { theme, Select, Popover } from 'antd';
import {
  PanelRightClose,
  Send,
  Square,
  Globe,
  GlobeOff,
  ChevronDown,
} from 'lucide-react';
import { useChatStore, type ChatMessage } from '../store/chat';
import { MessageBubble } from './MessageBubble';
import { ModelProviderSelect } from './ModelProviderSelect';
import { streamChat, type Agent, type Session } from '../services/desktop_api';

export interface BuilderPanelProps {
  agentName: string;
  scope: string;
  welcomeTitle: string;
  welcomeDescription: string;
  welcomeAvatar: string;
  suggestQuestions?: string[];
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
          <span style={{ fontSize: 14, lineHeight: 1 }}>{selected?.avatar || '🤖'}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: token.colorText }}>
            {selected?.title || selected?.name || selectedAgentName}
          </span>
        </Flexbox>
      )}
      options={agents.map((a) => ({
        value: a.name,
        label: (
          <Flexbox horizontal align="center" gap={6}>
            <span style={{ fontSize: 16 }}>{a.avatar || '🤖'}</span>
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
  welcomeAvatar,
  suggestQuestions,
  contextPayload,
  expand,
  onExpandChange,
  defaultWidth = 400,
  minWidth = 320,
  maxWidth = 560,
  showAgentSelector = false,
  showTopicSelector = false,
  onDocumentUpdated,
  disabled = false,
  disabledMessage,
}: BuilderPanelProps) {
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
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState('');
  const isComposingRef = useRef(false);

  const {
    agents,
    defaultModel,
    selectedModel,
    sessions,
    setSelectedModel,
  } = useChatStore();

  const currentModelId = selectedModel || defaultModel;

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
    const controller = streamChat(
      text,
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
        window.dispatchEvent(new CustomEvent('agent-builder:stream-end'));
        setLoading(false);
        abortRef.current = null;
      },
      (err) => {
        if (err.name !== 'AbortError') {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: `Error: ${err.message}`, loading: false } : m)),
          );
        }
        setLoading(false);
        abortRef.current = null;
      },
      [],
      modelOverride,
    );
    abortRef.current = controller;
  }, [input, loading, scopedSessionKey, currentAgent, contextPayload, selectedModel, defaultModel, searchEnabled, onDocumentUpdated]);

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
          background: token.colorBgLayout,
        }}
      >
        {/* Header */}
        <Flexbox
          horizontal
          align="center"
          justify="space-between"
          style={{
            padding: '0 12px',
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
              <span style={{ fontSize: 16 }}>{welcomeAvatar}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: token.colorText }}>{welcomeTitle}</span>
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
              placeholder="Select topic..."
              allowClear
              onClear={() => {
                setSessionKey('');
                setMessages([]);
              }}
              options={[
                { value: `${scope}:${currentAgent}`, label: `💬 Default` },
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
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, width: '100%', padding: '0 16px 24px' }}>
          {messages.length === 0 ? (
            <Center style={{ height: '100%', padding: 24 }}>
              <Flexbox align="center" gap={12}>
                <Avatar
                  avatar={welcomeAvatar}
                  size={48}
                  shape="square"
                  background="linear-gradient(135deg, #667eea, #764ba2)"
                  style={{ opacity: 0.5 }}
                />
                <span style={{ fontSize: 14, fontWeight: 500, color: token.colorText }}>
                  {welcomeTitle}
                </span>
                <span style={{ fontSize: 13, color: token.colorTextDescription, textAlign: 'center', maxWidth: 280 }}>
                  {welcomeDescription}
                </span>
                {suggestQuestions && suggestQuestions.length > 0 && (
                  <Flexbox gap={6} style={{ marginTop: 8, width: '100%', maxWidth: 300 }}>
                    {suggestQuestions.map((q) => (
                      <div
                        key={q}
                        onClick={() => handleSuggestClick(q)}
                        style={{
                          padding: '8px 12px',
                          borderRadius: 8,
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
        <Flexbox style={{ padding: '0 16px 16px', flexShrink: 0 }}>
          <Flexbox
            style={{
              background: token.colorBgContainer,
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              overflow: 'hidden',
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
              placeholder={disabled ? (disabledMessage || 'Disabled') : 'Ask, create, or start a task...'}
              rows={3}
              style={{
                width: '100%',
                resize: 'none',
                border: 'none',
                borderRadius: 0,
                padding: '10px 12px 4px',
                fontSize: 14,
                lineHeight: 1.6,
                outline: 'none',
                fontFamily: 'inherit',
                background: 'transparent',
                color: token.colorText,
                minHeight: 64,
                maxHeight: 160,
                overflow: 'auto',
              }}
            />
            <Flexbox horizontal align="center" justify="space-between" style={{ padding: '4px 8px 8px' }}>
              <Flexbox horizontal align="center" gap={2}>
                <Popover
                  open={modelOpen}
                  onOpenChange={setModelOpen}
                  placement="topLeft"
                  trigger="click"
                  content={
                    <ModelProviderSelect
                      selectedModelId={currentModelId}
                      onSelect={(id) => {
                        setSelectedModel(id);
                        setModelOpen(false);
                      }}
                      onClose={() => setModelOpen(false)}
                    />
                  }
                  styles={{ content: { padding: 0, minWidth: 280, maxWidth: 360 } }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      height: 32,
                      padding: '0 8px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      background: token.colorFillTertiary,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillSecondary; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = token.colorFillTertiary; }}
                  >
                    <ModelIcon model={currentModelId} size={18} />
                    <ChevronDown size={12} style={{ color: token.colorTextSecondary }} />
                  </div>
                </Popover>
                <div
                  onClick={() => setSearchEnabled(!searchEnabled)}
                  title={searchEnabled ? 'Web search ON' : 'Web search OFF'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: searchEnabled ? token.colorPrimaryBg : 'transparent',
                    color: searchEnabled ? token.colorPrimary : token.colorTextSecondary,
                    transition: 'all 0.15s',
                  }}
                >
                  {searchEnabled ? <Globe size={16} /> : <GlobeOff size={16} />}
                </div>
              </Flexbox>
              <Flexbox horizontal align="center" gap={4}>
                {loading ? (
                  <ActionIcon
                    icon={Square}
                    size="small"
                    onClick={handleStop}
                    title="Stop"
                    style={{ background: token.colorError, color: '#fff', borderRadius: 10 }}
                  />
                ) : (
                  <ActionIcon
                    icon={Send}
                    size="small"
                    onClick={handleSend}
                    disabled={!input.trim()}
                    title="Send"
                    style={{
                      background: input.trim() ? token.colorPrimary : token.colorFillSecondary,
                      color: input.trim() ? '#fff' : token.colorTextQuaternary,
                      borderRadius: 10,
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
