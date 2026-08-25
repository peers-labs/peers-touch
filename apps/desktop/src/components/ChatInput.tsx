import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { InputRef } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon } from '@lobehub/ui';
import { Dropdown, Input, theme } from 'antd';
import type { MenuProps } from 'antd';
import { ArrowUp, ChevronDown, ChevronUp, Image as ImageIcon, Search, Slash, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore, type ChatComposerAttachment } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { useMentionStore } from '../store/mentions';
import { useAgentAttachmentDrafts } from './composer/useAgentAttachmentDrafts';
import { useMentionTrigger } from './chat/composer/useMentionTrigger';
import { MentionPopup } from './chat/MentionPopup';
import { MentionTagBar } from './chat/MentionTag';
import type { AvailableModel, Agent } from '../services/desktop_api';
import { ProviderIcon } from './settings/ProviderIcon';

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
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<InputRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const topicDraftRef = useRef<Record<string, string>>({});
  const prevSessionKeyRef = useRef('');
  const { token } = theme.useToken();
  const { t } = useTranslation('chat');

  const sendMessage = useChatStore(s => s.sendMessage);
  const stopStreaming = useChatStore(s => s.stopStreaming);
  const isStreaming = useChatStore(s => s.isStreaming);
  const currentSessionKey = useChatStore(s => s.currentSessionKey);
  const readinessErrorKey = useChatStore(s => s.readinessErrorKey);
  const composerFill = useChatStore(s => s.composerFill);
  const consumeComposerFill = useChatStore(s => s.consumeComposerFill);
  const selectedModel = useAgentStore(s => s.selectedModel);
  const selectedProviderId = useAgentStore(s => s.selectedProviderId);
  const defaultModel = useAgentStore(s => s.defaultModel);
  const availableModels = useAgentStore(s => s.availableModels);
  const setSelectedModel = useAgentStore(s => s.setSelectedModel);

  // Mention (@) system — wires the standalone mention store/popup/trigger into
  // the live agent composer. Aligns Peers @mention with LobeHub composer-level
  // mention draft behavior.
  const { handleInputChange: mentionScan, handleKeyDown: mentionKeyDown } = useMentionTrigger();
  const clearMentions = useMentionStore(s => s.clearMentions);
  const showMentionPopup = useMentionStore(s => s.showMentionPopup);

  const {
    drafts,
    readyAttachments,
    uploading,
    addFiles,
    clearDrafts,
    removeDraft,
  } = useAgentAttachmentDrafts({
    conversationId: currentSessionKey,
    disabled: isStreaming,
    fallbackName: t('chat.input.attachmentFallbackName'),
  });

  useEffect(() => {
    const previousKey = prevSessionKeyRef.current;
    if (previousKey) topicDraftRef.current[previousKey] = input;
    setInput(topicDraftRef.current[currentSessionKey] || '');
    prevSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    if (currentSessionKey) topicDraftRef.current[currentSessionKey] = input;
  }, [currentSessionKey, input]);

  // I2 follow-up: consume a pending composer-fill request (fill-not-send), aligning
  // with LobeHub `fillInputMessage`. Populate the draft, focus, then clear the request.
  useEffect(() => {
    if (!composerFill) return;
    setInput(composerFill.text);
    consumeComposerFill();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const end = composerFill.text.length;
        el.setSelectionRange(end, end);
      }
    });
  }, [composerFill, consumeComposerFill]);

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
    const accepted = sendMessage(text, toComposerAttachments());
    if (!accepted) return;
    setInput('');
    clearDrafts();
    clearMentions();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, readyAttachments.length, isStreaming, uploading, sendMessage, toComposerAttachments, clearDrafts, clearMentions]);

  // Scan the draft for "@" triggers whenever it changes, driving the popup.
  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setInput(value);
    mentionScan(value, event.target.selectionStart ?? value.length);
  }, [mentionScan]);

  // Insert the selected agent's mention token into the draft at the "@" position.
  const handleMentionSelect = useCallback((_agent: Agent, insertText: string) => {
    const el = textareaRef.current;
    setInput((prev) => {
      const cursor = el?.selectionStart ?? prev.length;
      const before = prev.slice(0, cursor);
      const after = prev.slice(cursor);
      const atIndex = before.lastIndexOf('@');
      if (atIndex === -1) return prev;
      const next = before.slice(0, atIndex) + insertText + after;
      return next;
    });
    // Return focus to the textarea after selection.
    requestAnimationFrame(() => el?.focus());
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Let the mention popup consume navigation keys while it is open.
    if (mentionKeyDown(event)) return;
    if (event.key !== 'Enter' || event.shiftKey) return;
    const native = event.nativeEvent as unknown as { isComposing?: boolean; keyCode?: number };
    if (isComposingRef.current || native.isComposing || native.keyCode === 229) return;
    event.preventDefault();
    handleSend();
  }, [handleSend, mentionKeyDown]);

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

  const modelDisplayName = modelInfo?.display_name || modelInfo?.id || currentModelId;
  const modelLabel = modelInfo
    ? modelDisplayName
    : currentModelId || t('chat.model.select');

  const modelMenu = useMemo<MenuProps>(() => {
    const search = modelSearch.trim().toLowerCase();
    const groups = new Map<string, AvailableModel[]>();
    for (const model of availableModels) {
      if (!model.enabled) continue;
      if (search) {
        const name = (model.display_name || model.id).toLowerCase();
        const provider = (model.provider_name || model.provider_id || '').toLowerCase();
        if (!name.includes(search) && !provider.includes(search)) continue;
      }
      const key = model.provider_name || model.provider_id || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(model);
    }
    return {
      selectedKeys: currentModelKey ? [currentModelKey] : [],
      style: { maxHeight: 320, minHeight: 320, overflowY: 'auto', padding: '4px 0', border: 'none', boxShadow: 'none', borderRadius: 0, background: 'transparent' },
      items: Array.from(groups.entries()).map(([provider, items]) => ({
        key: `group-${provider}`,
        type: 'group' as const,
        label: (
          <Flexbox horizontal align="center" gap={6}>
            <ProviderIcon
              providerId={items[0]?.provider_id || ''}
              providerName={provider}
              size={14}
            />
            <span style={{ fontSize: 11, color: token.colorTextTertiary, fontWeight: 500 }}>
              {provider}
            </span>
          </Flexbox>
        ),
        children: items.map((model) => ({
          key: modelMenuKey(model),
          label: (
            <Flexbox horizontal align="center" gap={8}>
              <ProviderIcon
                providerId={model.provider_id || ''}
                providerName={model.provider_name}
                size={18}
              />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
                {model.display_name || model.id}
              </span>
            </Flexbox>
          ),
        })),
      })),
      onClick: ({ key }) => {
        const next = availableModels.find((model) => modelMenuKey(model) === key);
        if (next) {
          setSelectedModel(next.id, next.provider_id);
          setModelDropdownOpen(false);
          setModelSearch('');
        }
      },
    };
  }, [availableModels, currentModelKey, setSelectedModel, token.colorTextTertiary, modelSearch]);

  const dropdownRender = useCallback((menu: React.ReactNode) => (
    <div
      style={{
        background: '#ffffff',
        borderRadius: 12,
        boxShadow: '0 8px 24px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        width: 260,
      }}
    >
      <div style={{ padding: '8px 10px 6px' }}>
        <Input
          ref={searchInputRef}
          prefix={<Search size={14} color={token.colorTextQuaternary} />}
          placeholder={t('chat.model.search', 'Search models...')}
          value={modelSearch}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setModelSearch(e.target.value)}
          variant="borderless"
          size="small"
          autoFocus
          style={{ fontSize: 13 }}
        />
      </div>
      <div style={{ height: 1, background: token.colorFillQuaternary, margin: '0 10px' }} />
      {menu}
    </div>
  ), [modelSearch, t, token.colorFillQuaternary, token.colorTextQuaternary]);

  return (
    <section
      data-pt-agent-composer
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

      {readinessErrorKey && (
        <div style={{ color: token.colorError, fontSize: 12 }}>
          {t(readinessErrorKey)}
        </div>
      )}

      <MentionTagBar />

      <div style={{ position: 'relative', width: '100%' }}>
        {showMentionPopup && <MentionPopup onSelect={handleMentionSelect} />}
        <textarea
          data-pt-agent-composer-input
          ref={textareaRef}
          value={input}
          onChange={handleInputChange}
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
      </div>

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
          <Dropdown
            menu={modelMenu}
            trigger={['click']}
            placement="topRight"
            arrow={false}
            open={modelDropdownOpen}
            onOpenChange={(open) => {
              setModelDropdownOpen(open);
              if (!open) setModelSearch('');
              if (open) setTimeout(() => searchInputRef.current?.focus(), 50);
            }}
            dropdownRender={dropdownRender}
            overlayStyle={{ padding: 0, border: 'none', borderRadius: 12, boxShadow: 'none' }}
          >
            <button
              type="button"
              style={{
                height: 28,
                border: 0,
                background: 'transparent',
                color: token.colorTextSecondary,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 13,
                cursor: 'pointer',
                padding: '0 4px',
                maxWidth: '100%',
                lineHeight: 1,
                borderRadius: 6,
              }}
            >
              {modelInfo && (
                <ProviderIcon
                  providerId={modelInfo.provider_id || ''}
                  providerName={modelInfo.provider_name}
                  size={16}
                />
              )}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>{modelLabel}</span>
              {modelDropdownOpen
                ? <ChevronUp size={12} color={COMPOSER_COLORS.textTertiary} style={{ flexShrink: 0 }} />
                : <ChevronDown size={12} color={COMPOSER_COLORS.textTertiary} style={{ flexShrink: 0 }} />
              }
            </button>
          </Dropdown>
        </div>

        <Flexbox horizontal align="center" gap={8} justify="flex-end">
          {isStreaming ? (
            <ActionIcon
              data-pt-agent-stop
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
              data-pt-agent-composer-send
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
