import {
  useRef,
  useState,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Flexbox } from 'react-layout-kit';
import { Send, Square, RotateCw } from 'lucide-react';
import { theme } from 'antd';

interface MessageComposerProps {
  onSend: (text: string) => void;
  loading?: boolean;
  onStop?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Toolbar rendered between textarea and send button row */
  toolbar?: ReactNode;
  /** Extra content above the textarea (e.g. image previews) */
  header?: ReactNode;
  /** Footer text below the composer */
  footer?: ReactNode;
  autoFocus?: boolean;
}

export function MessageComposer({
  onSend,
  loading,
  onStop,
  placeholder = 'Type a message...',
  disabled,
  toolbar,
  header,
  footer,
  autoFocus,
}: MessageComposerProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { token } = theme.useToken();

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || loading || disabled) return;
    onSend(text);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, loading, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }, []);

  const hasContent = input.trim().length > 0;
  const canSend = hasContent && !loading && !disabled;

  return (
    <Flexbox
      style={{
        background: token.colorBgContainer,
        padding: '8px 16px 12px',
        borderTop: `1px solid ${token.colorBorderSecondary}`,
      }}
      gap={0}
    >
      {header}

      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
        placeholder={placeholder}
        rows={1}
        disabled={disabled}
        style={{
          width: '100%',
          resize: 'none',
          border: 'none',
          borderRadius: 0,
          padding: '8px 0',
          fontSize: 14,
          lineHeight: '1.6',
          outline: 'none',
          fontFamily: 'inherit',
          background: 'transparent',
          color: token.colorText,
          maxHeight: 200,
          overflow: 'auto',
        }}
      />

      <Flexbox horizontal align="center" justify="space-between" style={{ paddingTop: 2 }}>
        <Flexbox horizontal align="center" gap={0}>
          {toolbar}
        </Flexbox>

        <Flexbox horizontal align="center" gap={4}>
          {loading && onStop ? (
            <button
              onClick={onStop}
              title="Stop"
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                border: 'none',
                background: token.colorError,
                color: '#fff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              title="Send"
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                border: 'none',
                background: canSend
                  ? token.colorPrimary
                  : token.colorFillSecondary,
                color: canSend ? '#fff' : token.colorTextQuaternary,
                cursor: canSend ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'all 0.2s',
              }}
            >
              {loading ? (
                <RotateCw size={18} className="spin" />
              ) : (
                <Send size={18} />
              )}
            </button>
          )}
        </Flexbox>
      </Flexbox>

      {footer && (
        <div style={{ textAlign: 'center', paddingTop: 4 }}>{footer}</div>
      )}
    </Flexbox>
  );
}
