import { useState } from 'react';
import { Button, Empty, Input, theme } from 'antd';
import { ChevronLeft, SendHorizontal } from 'lucide-react';

interface BuilderPanelProps {
  agentName: string;
  scope?: string;
  welcomeTitle?: string;
  welcomeDescription?: string;
  welcomeAvatar?: string;
  suggestQuestions?: string[];
  contextPayload?: Record<string, unknown>;
  expand: boolean;
  onExpandChange?: (expand: boolean) => void;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  disabled?: boolean;
  disabledMessage?: string;
}

export function BuilderPanel({
  agentName,
  welcomeTitle = 'Agent',
  welcomeDescription,
  suggestQuestions = [],
  expand,
  onExpandChange,
  defaultWidth = 360,
  minWidth = 260,
  maxWidth = 640,
  disabled = false,
  disabledMessage,
}: BuilderPanelProps) {
  const { token } = theme.useToken();
  const [input, setInput] = useState('');
  const width = Math.min(Math.max(defaultWidth, minWidth), maxWidth);

  if (!expand) return null;

  return (
    <div style={{ width, flexShrink: 0, borderLeft: `1px solid ${token.colorBorderSecondary}`, background: token.colorBgContainer, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{welcomeTitle}</span>
        <span style={{ fontSize: 11, color: token.colorTextTertiary }}>{agentName}</span>
        <Button type="text" size="small" icon={<ChevronLeft size={14} />} onClick={() => onExpandChange?.(false)} style={{ marginLeft: 'auto' }} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
        {disabled ? (
          <Empty description={disabledMessage || 'Unavailable'} />
        ) : (
          <>
            <p style={{ marginTop: 0, color: token.colorTextSecondary, fontSize: 12 }}>{welcomeDescription}</p>
            {suggestQuestions.map((q) => (
              <Button key={q} size="small" style={{ marginRight: 8, marginBottom: 8 }} onClick={() => setInput(q)}>
                {q}
              </Button>
            ))}
          </>
        )}
      </div>
      <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, padding: 10, display: 'flex', gap: 8 }}>
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder={disabled ? disabledMessage : 'Ask agent...'} disabled={disabled} onPressEnter={() => setInput('')} />
        <Button icon={<SendHorizontal size={14} />} disabled={disabled || !input.trim()} onClick={() => setInput('')} />
      </div>
    </div>
  );
}
