import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { Dropdown, theme } from 'antd';
import type { MenuProps } from 'antd';
import { ArrowUp, ChevronDown, Image as ImageIcon, Slash, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore, type ChatComposerAttachment } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { useChatAttachmentDrafts } from './chat/composer/useChatAttachmentDrafts';
import type { AvailableModel } from '../services/desktop_api';

const COMPOSER_COLORS = {
  border: '#d1d1d1',
  borderSoft: '#ececec',
  primaryDisabled: '#d8d3fb',
  textTertiary: '#9b9b9b',
  toolButtonShadow: '0 1px 4px rgba(15,23,42,0.04)',
} as const;

export interface ChatInputProps {
  placeholder?: string;
  minHeight?: number;
}

function modelMenuKey(model: AvailableModel): string {
  return `${encodeURIComponent(model.provider_id || '')}/${encodeURIComponent(model.id)}`;
}

export function ChatInput({ placeholder: customPlaceholder, minHeight = 96 }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const topicDraftRef = useRef<Record<string, string>>({});
  const prevSessionKeyRef = useRef('');
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const { sendMessage, stopStreaming, isStreaming, currentSessionKey } = useChatStore();
  const { selectedModel, selectedProviderId, defaultModel, availableModels, loadModels, setSelectedModel } = useAgentStore();

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
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
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
  const modelInfo =
    availableModels.find((model) => model.id === currentModelId && (!selectedProviderId || model.provider_id === selectedProviderId)) ||
    availableModels.find((model) => model.id === currentModelId);
  const currentModelKey = modelInfo ? modelMenuKey(modelInfo) : currentModelId;
  const sendDisabled = (!input.trim() && readyAttachments.length === 0) || isStreaming || uploading;

  const providerName = modelInfo?.provider_name || selectedProviderId || '';
  const modelDisplayName = modelInfo?.display_name || modelInfo?.id || currentModelId;
  const modelLabel = modelInfo
    ? `${providerName} · ${modelDisplayName}`
    : currentModelId || t('chat.model.select');

  const modelMenu = useMemo<MenuProps>(() => ({
    selectedKeys: currentModelKey ? [currentModelKey] : [],
    items: availableModels
      .filter((model) => model.enabled)
      .map((model) => ({
        key: modelMenuKey(model),
        label: (
          <Flexbox horizontal align="center" gap={8} style={{ minWidth: 160 }}>
            <ModelIcon model={model.id} size={16} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {model.display_name || model.id}
            </span>
            <span style={{ color: token.colorTextTertiary, fontSize: 11, marginLeft: 'auto' }}>
              {model.provider_name || model.provider_id}
            </span>
          </Flexbox>
        ),
      })),
    onClick: ({ key }) => {
      const next = availableModels.find((model) => modelMenuKey(model) === key);
      if (next) setSelectedModel(next.id, next.provider_id);
    },
  }), [availableModels, currentModelKey, setSelectedModel, token.colorTextTertiary]);

  return (
    <section
      style={{
        width: '100%',
        minHeight,
        border: `1px solid ${COMPOSER_COLORS.border}`,
        borderRadius: 18,
        background: '#ffffff',
        boxSizing: 'border-box',
        padding: '12px 14px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: 8,
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

      <Flexbox horizontal align="center" gap={8}>
        <Flexbox horizontal align="center" gap={8}>
          <ActionIcon
            icon={Slash}
            onClick={insertSlash}
            title={t('chat.input.slashCommand')}
            size={{ blockSize: 28, size: 13 }}
            style={{
              borderRadius: 8,
              border: `1px solid ${COMPOSER_COLORS.borderSoft}`,
              background: '#ffffff',
              color: token.colorText,
              boxShadow: COMPOSER_COLORS.toolButtonShadow,
            }}
          />
          <ActionIcon
            icon={ImageIcon}
            onClick={handlePickImages}
            title={t('chat.input.uploadFile')}
            size={{ blockSize: 28, size: 13 }}
            style={{
              borderRadius: 8,
              border: `1px solid ${COMPOSER_COLORS.borderSoft}`,
              background: '#ffffff',
              color: token.colorText,
              boxShadow: COMPOSER_COLORS.toolButtonShadow,
            }}
          />
        </Flexbox>

        <div style={{ flex: 1, minWidth: 8 }} />

        <div style={{ minWidth: 0, display: 'flex', justifyContent: 'flex-end', overflow: 'hidden' }}>
          <Dropdown menu={modelMenu} trigger={['click']} placement="top">
            <button
              type="button"
              style={{
                height: 28,
                border: 0,
                background: 'transparent',
                color: token.colorTextSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                fontSize: 13,
                cursor: 'pointer',
                padding: '0 4px',
                maxWidth: '100%',
                lineHeight: 1,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>{modelLabel}</span>
              <ChevronDown size={12} color={COMPOSER_COLORS.textTertiary} style={{ flexShrink: 0 }} />
            </button>
          </Dropdown>
        </div>

        <Flexbox horizontal align="center" gap={8} justify="flex-end">
          {isStreaming ? (
            <ActionIcon
              icon={Square}
              onClick={stopStreaming}
              title={t('chat.input.stop')}
              size={{ blockSize: 34, size: 16 }}
              style={{
                borderRadius: 10,
                background: token.colorError,
                color: '#ffffff',
              }}
            />
          ) : (
            <ActionIcon
              icon={ArrowUp}
              onClick={handleSend}
              disabled={sendDisabled}
              title={t('chat.input.send')}
              size={{ blockSize: 34, size: 16 }}
              style={{
                borderRadius: 10,
                background: sendDisabled ? COMPOSER_COLORS.primaryDisabled : token.colorPrimary,
                color: sendDisabled ? COMPOSER_COLORS.textTertiary : '#ffffff',
                cursor: sendDisabled ? 'default' : 'pointer',
              }}
            />
          )}
        </Flexbox>
      </Flexbox>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />
    </section>
  );
}
