import { useCallback, useState } from 'react';
import { Button, Input, theme } from 'antd';
import { SendHorizontal } from 'lucide-react';

interface MessageComposerProps {
  onSend: (text: string) => void | Promise<void>;
  loading?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  footer?: React.ReactNode;
}

export function MessageComposer({
  onSend,
  loading = false,
  placeholder,
  disabled = false,
  autoFocus = false,
  footer,
}: MessageComposerProps) {
  const { token } = theme.useToken();
  const [text, setText] = useState('');

  const handleSend = useCallback(async () => {
    const next = text.trim();
    if (!next || loading || disabled) return;
    setText('');
    await onSend(next);
  }, [disabled, loading, onSend, text]);

  return (
    <div style={{ borderTop: `1px solid ${token.colorBorderSecondary}`, padding: '10px 12px' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoSize={{ minRows: 1, maxRows: 5 }}
          autoFocus={autoFocus}
          disabled={disabled}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          type="primary"
          icon={<SendHorizontal size={14} />}
          loading={loading}
          disabled={disabled || !text.trim()}
          onClick={() => void handleSend()}
        >
          Send
        </Button>
      </div>
      {footer ? <div style={{ marginTop: 8 }}>{footer}</div> : null}
    </div>
  );
}
