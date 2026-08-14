import { useCallback, useRef, type KeyboardEvent } from 'react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';

interface ComposerTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onResize: () => void;
  placeholder?: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

/**
 * Plain <textarea> with auto-resize and IME composition guard.
 * Enter sends (unless Shift is held or IME is composing).
 */
export function ComposerTextarea({
  value,
  onChange,
  onSend,
  onResize,
  placeholder: customPlaceholder,
  textareaRef,
}: ComposerTextareaProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');
  const isComposingRef = useRef(false);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (isComposingRef.current || native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    onSend();
  }, [onSend]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onInput={onResize}
      onCompositionStart={() => { isComposingRef.current = true; }}
      onCompositionEnd={() => { isComposingRef.current = false; }}
      placeholder={customPlaceholder || t('chat.input.placeholder')}
      rows={2}
      style={{
        width: '100%',
        minHeight: 34,
        maxHeight: 190,
        border: 0,
        outline: 'none',
        resize: 'none',
        color: token.colorText,
        fontSize: 14,
        lineHeight: 1.5,
        fontFamily: 'inherit',
        background: 'transparent',
        boxSizing: 'border-box',
        padding: 0,
      }}
    />
  );
}
