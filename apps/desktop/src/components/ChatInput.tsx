import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { Dropdown, theme } from 'antd';
import type { MenuProps } from 'antd';
import { ChevronDown, ImagePlus, Send, Slash, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore, type ChatComposerAttachment } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { useChatAttachmentDrafts } from './chat/composer/useChatAttachmentDrafts';

export interface ChatInputProps {
  placeholder?: string;
}

export function ChatInput({ placeholder: customPlaceholder }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const topicDraftRef = useRef<Record<string, string>>({});
  const prevSessionKeyRef = useRef('');
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const { sendMessage, stopStreaming, isStreaming, currentSessionKey } = useChatStore();
  const { selectedModel, defaultModel, availableModels, loadModels, setSelectedModel } = useAgentStore();

  const {
    drafts,
    readyAttachments,
    uploading,
    addFiles,
    clearDrafts,
    removeDraft,
  } = useChatAttachmentDrafts({
    conversationId: currentSessionKey,
    disabled: isStreaming,
    editing: false,
    fallbackName: t('chat.input.attachmentFallbackName'),
    onUploadFailed: () => {},
  });

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
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  const toComposerAttachments = useCallback((): ChatComposerAttachment[] =>
    readyAttachments.map((attachment) => ({
      cid: attachment.cid,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: attachment.size,
      attachment,
    })),
  [readyAttachments]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if ((!text && readyAttachments.length === 0) || isStreaming || uploading) return;
    sendMessage(text, toComposerAttachments());
    setInput('');
    clearDrafts();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, readyAttachments.length, isStreaming, uploading, sendMessage, toComposerAttachments, clearDrafts]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (isComposingRef.current || native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    handleSend();
  }, [handleSend]);

  const insertSlash = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      setInput((prev) => `${prev}/`);
      return;
    }
    el.focus();
    setInput((prev) => `${prev}/`);
  }, []);

  const handlePickImages = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) addFiles(files);
    event.target.value = '';
  }, [addFiles]);

  const currentModelId = selectedModel || defaultModel;
  const modelInfo = availableModels.find((model) => model.id === currentModelId);
  const sendDisabled = (!input.trim() && readyAttachments.length === 0) || isStreaming || uploading;

  const modelMenu = useMemo<MenuProps>(() => ({
    selectedKeys: currentModelId ? [currentModelId] : [],
    items: availableModels
      .filter((model) => model.enabled)
      .map((model) => ({
        key: model.id,
        label: (
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 160 }}>
            <ModelIcon model={model.id} size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model.display_name || model.id}
            </span>
          </Flexbox>
        ),
      })),
    onClick: ({ key }) => {
      const next = availableModels.find((model) => model.id === key);
      setSelectedModel(key, next?.provider_id);
    },
  }), [availableModels, currentModelId, setSelectedModel]);

  const circleButtonStyle = {
    borderRadius: '50%',
    background: token.colorFillTertiary,
    color: token.colorTextSecondary,
  } as const;

  return (
    <Flexbox
      gap={10}
      style={{
        width: '100%',
        padding: '12px 14px 10px',
        borderRadius: 24,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: '0 8px 32px rgba(15, 23, 42, 0.06)',
      }}
    >
      {drafts.length > 0 && (
        <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
          {drafts.map((draft) => (
            <Flexbox
              key={draft.id}
              horizontal
              align="center"
              gap={6}
              style={{
                maxWidth: 220,
                padding: '4px 8px 4px 10px',
                borderRadius: 10,
                background: token.colorFillQuaternary,
                opacity: draft.status === 'uploading' ? 0.6 : 1,
              }}
            >
              {draft.previewUrl ? (
                <img
                  src={draft.previewUrl}
                  alt={draft.name}
                  style={{ width: 24, height: 24, borderRadius: 6, objectFit: 'cover' }}
                />
              ) : null}
              <span style={{ fontSize: 12, color: token.colorTextSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {draft.name}
              </span>
              <ActionIcon
                icon={X}
                size="small"
                title={t('chat.input.attachmentRemove')}
                onClick={() => removeDraft(draft.id)}
              />
            </Flexbox>
          ))}
        </Flexbox>
      )}

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
        rows={1}
        style={{
          width: '100%',
          resize: 'none',
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: token.colorText,
          fontFamily: 'inherit',
          fontSize: 15,
          lineHeight: 1.5,
          minHeight: 28,
          maxHeight: 200,
          overflow: 'auto',
          padding: '2px 4px',
        }}
      />

      <Flexbox horizontal align="center" gap={8}>
        <ActionIcon
          icon={Slash}
          onClick={insertSlash}
          title={t('chat.input.slashCommand')}
          size={{ blockSize: 34, size: 16 }}
          style={circleButtonStyle}
        />
        <ActionIcon
          icon={ImagePlus}
          onClick={handlePickImages}
          title={t('chat.input.uploadFile')}
          size={{ blockSize: 34, size: 18 }}
          style={circleButtonStyle}
        />

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <Dropdown menu={modelMenu} trigger={['click']} placement="top">
            <Flexbox
              horizontal
              align="center"
              gap={6}
              style={{
                height: 34,
                padding: '0 12px',
                borderRadius: 999,
                background: token.colorFillQuaternary,
                color: token.colorTextSecondary,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                maxWidth: 260,
              }}
            >
              <ModelIcon model={currentModelId} size={16} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {modelInfo?.display_name || currentModelId || t('chat.model.select')}
              </span>
              <ChevronDown size={14} style={{ flexShrink: 0 }} />
            </Flexbox>
          </Dropdown>
        </div>

        {isStreaming ? (
          <ActionIcon
            icon={Square}
            onClick={stopStreaming}
            title={t('chat.input.stop')}
            size={{ blockSize: 34, size: 16 }}
            style={{ background: token.colorError, color: '#fff', borderRadius: '50%', flexShrink: 0 }}
          />
        ) : (
          <ActionIcon
            icon={Send}
            onClick={handleSend}
            disabled={sendDisabled}
            title={t('chat.input.send')}
            size={{ blockSize: 34, size: 16 }}
            style={{
              background: !sendDisabled ? token.colorPrimary : token.colorFillSecondary,
              color: !sendDisabled ? '#fff' : token.colorTextQuaternary,
              borderRadius: '50%',
              flexShrink: 0,
            }}
          />
        )}
      </Flexbox>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />
    </Flexbox>
  );
}
