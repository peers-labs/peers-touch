import { useState, useRef, useEffect, useCallback } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Markdown } from '@lobehub/ui';
import { theme, Tag } from 'antd';
import { Play, Bot, User } from 'lucide-react';
import { api } from '../../services/api';
import { MessageComposer } from '../../components/MessageComposer';
import type { AgentMessage, AgentResponse } from './types';

interface AgentChatProps {
  sessionId: string | null;
  onRunCommand?: (cmd: string) => void;
}

export function AgentChat({ sessionId, onRunCommand }: AgentChatProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const { token } = theme.useToken();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(
    async (text: string) => {
      if (loading) return;

      const userMsg: AgentMessage = {
        role: 'user',
        content: text,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setLoading(true);

      try {
        // Build history from previous messages (last 10)
        const recent = messages.slice(-10);
        const history = recent.map((m) => ({
          role: m.role,
          content: m.role === 'assistant' ? m.content : m.content,
        }));

        const resp = await api.appletAction<AgentResponse>('remote-cli', 'agent-chat', {
          session_id: sessionId || '',
          message: text,
          history,
        });

        const assistantMsg: AgentMessage = {
          role: 'assistant',
          content: resp.text,
          commands: resp.commands,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e: any) {
        const errMsg: AgentMessage = {
          role: 'assistant',
          content: `Error: ${e.message}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setLoading(false);
      }
    },
    [sessionId, messages, loading],
  );

  return (
    <Flexbox
      style={{
        height: '100%',
        background: token.colorBgContainer,
      }}
    >
      {/* Header */}
      <Flexbox
        horizontal
        align="center"
        gap={8}
        style={{
          padding: '10px 16px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
        }}
      >
        <Bot size={18} color={token.colorPrimary} />
        <span style={{ fontWeight: 600, fontSize: 14 }}>CLI Agent</span>
        {!sessionId && (
          <Tag color="warning" style={{ marginLeft: 'auto', fontSize: 11 }}>
            No session
          </Tag>
        )}
      </Flexbox>

      {/* Messages */}
      <Flexbox
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '12px 16px',
          gap: 16,
        }}
      >
        {messages.length === 0 && (
          <Flexbox
            align="center"
            justify="center"
            style={{ flex: 1, color: token.colorTextQuaternary, textAlign: 'center', padding: 24 }}
          >
            <Bot size={40} strokeWidth={1.2} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontSize: 13 }}>
              Ask me about commands, troubleshooting, or to analyze terminal output.
            </div>
          </Flexbox>
        )}
        {messages.map((msg, i) => (
          <Flexbox key={i} gap={6}>
            <Flexbox horizontal align="center" gap={6}>
              {msg.role === 'user' ? (
                <User size={14} color={token.colorTextSecondary} />
              ) : (
                <Bot size={14} color={token.colorPrimary} />
              )}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: msg.role === 'user' ? token.colorTextSecondary : token.colorPrimary,
                }}
              >
                {msg.role === 'user' ? 'You' : 'CLI Agent'}
              </span>
            </Flexbox>

            {msg.role === 'user' ? (
              <div
                style={{
                  fontSize: 13,
                  color: token.colorText,
                  padding: '8px 12px',
                  background: token.colorFillQuaternary,
                  borderRadius: 8,
                }}
              >
                {msg.content}
              </div>
            ) : (
              <div
                style={{
                  fontSize: 13,
                  padding: '8px 12px',
                  background: token.colorFillQuaternary,
                  borderRadius: 8,
                }}
              >
                <Markdown variant="chat" fontSize={13}>
                  {msg.content}
                </Markdown>
              </div>
            )}

            {/* Command suggestions */}
            {msg.commands && msg.commands.length > 0 && (
              <Flexbox gap={4} style={{ paddingLeft: 4 }}>
                {msg.commands.map((cmd, ci) => (
                  <Flexbox
                    key={ci}
                    horizontal
                    align="center"
                    gap={6}
                    style={{
                      padding: '4px 10px',
                      background: token.colorFillTertiary,
                      borderRadius: 6,
                      cursor: 'pointer',
                      fontSize: 12,
                      fontFamily:
                        'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
                      transition: 'background 0.15s',
                    }}
                    onClick={() => onRunCommand?.(cmd)}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        token.colorPrimaryBg;
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        token.colorFillTertiary;
                    }}
                  >
                    <Play size={11} color={token.colorPrimary} />
                    <span style={{ color: token.colorText }}>{cmd}</span>
                  </Flexbox>
                ))}
              </Flexbox>
            )}
          </Flexbox>
        ))}
        <div ref={bottomRef} />
      </Flexbox>

      {/* Input */}
      <div style={{ padding: '8px 12px', borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <MessageComposer
          onSend={handleSend}
          loading={loading}
          placeholder={sessionId ? 'Ask the CLI agent...' : 'Connect to a server first...'}
          disabled={!sessionId}
        />
      </div>
    </Flexbox>
  );
}
