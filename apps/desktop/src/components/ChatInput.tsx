import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { Send, Square } from 'lucide-react';
import { theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { useChatStore } from '../store/chat';
import { useAgentStore } from '../store/agent';

export interface ChatInputProps {
  placeholder?: string;
}

export function ChatInput({ placeholder: customPlaceholder }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const topicDraftRef = useRef<Record<string, string>>({});
  const prevSessionKeyRef = useRef('');
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const { sendMessage, stopStreaming, isStreaming, currentSessionKey } = useChatStore();
  const { selectedModel, defaultModel, availableModels, loadModels } = useAgentStore();

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  useEffect(() => {
    const previousKey = prevSessionKeyRef.current;
    if (previousKey) topicDraftRef.current[previousKey] = input;
    setInput(topicDraftRef.current[currentSessionKey] || '');
    prevSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    if (currentSessionKey) topicDraftRef.current[currentSessionKey] = input;
  }, [currentSessionKey, input]);

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;
    sendMessage(text);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (isComposingRef.current || native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    handleSend();
  }, [handleSend]);

  const currentModelId = selectedModel || defaultModel;
  const modelInfo = availableModels.find((model) => model.id === currentModelId);
  const sendDisabled = !input.trim() || isStreaming;

  return (
    <Flexbox
      gap={18}
      style={{
        width: '100%',
        minHeight: 256,
        padding: '34px 36px 28px',
        borderRadius: 40,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: '0 18px 64px rgba(15, 23, 42, 0.06)',
      }}
    >
      <Flexbox flex={1} gap={8} style={{ minWidth: 0 }}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onInput={resizeTextarea}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder={customPlaceholder || t('chat.input.placeholder')}
          rows={2}
          style={{
            width: '100%',
            resize: 'none',
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: token.colorText,
            fontFamily: 'inherit',
            fontSize: 28,
            lineHeight: 1.35,
            minHeight: 112,
            maxHeight: 180,
            overflow: 'auto',
            padding: 0,
          }}
        />
      </Flexbox>
      <Flexbox horizontal align="center" gap={16}>
        <div style={{ flex: 1 }} />
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 58,
            padding: '0 24px',
            borderRadius: 999,
            background: token.colorFillQuaternary,
            color: token.colorTextTertiary,
            fontSize: 13,
            fontWeight: 650,
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {modelInfo?.display_name || currentModelId || t('chat.model.select')}
          </span>
        </span>
      {isStreaming ? (
        <ActionIcon
          icon={Square}
          onClick={stopStreaming}
          title={t('chat.input.stop')}
          size={{ blockSize: 58, size: 28 }}
          style={{ background: token.colorError, color: '#fff', borderRadius: 22, flexShrink: 0 }}
        />
      ) : (
        <ActionIcon
          icon={Send}
          onClick={handleSend}
          disabled={sendDisabled}
          title={t('chat.input.send')}
          size={{ blockSize: 58, size: 28 }}
          style={{
            background: !sendDisabled ? token.colorPrimary : token.colorFillSecondary,
            color: !sendDisabled ? '#fff' : token.colorTextQuaternary,
            borderRadius: 22,
            flexShrink: 0,
          }}
        />
      )}
      </Flexbox>
    </Flexbox>
  );
}
