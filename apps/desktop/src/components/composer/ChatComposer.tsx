import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatStore, type ChatComposerAttachment } from '../../store/chat';
import { useAgentStore } from '../../store/agent';
import { useAgentAttachmentDrafts, AGENT_ATTACHMENT_ACCEPT } from './useAgentAttachmentDrafts';
import { AttachmentStage } from './AttachmentStage';
import { ComposerTextarea } from './ComposerTextarea';
import { ComposerFooter } from './ComposerFooter';
import { defaultLeftActions } from './ActionBar';
import type { ActionBarContext, ActionBarItem } from './ActionBar/types';

const COMPOSER_COLORS = {
  border: '#d1d1d1',
} as const;

export interface ChatComposerProps {
  placeholder?: string;
  minHeight?: number;
  /** Override left-side action items */
  leftActions?: ActionBarItem[];
}

/**
 * Root composer component — thin orchestrator that wires textarea, file staging,
 * action bar, model picker, and send control together.
 *
 * Replaces the monolithic ChatInput.tsx. Behavior is identical; structure is
 * registry-driven and composable.
 */
export function ChatComposer({
  placeholder,
  minHeight = 96,
  leftActions = defaultLeftActions,
}: ChatComposerProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topicDraftRef = useRef<Record<string, string>>({});
  const prevSessionKeyRef = useRef('');
  const { t } = useTranslation('chat');

  const sendMessage = useChatStore(s => s.sendMessage);
  const stopStreaming = useChatStore(s => s.stopStreaming);
  const isStreaming = useChatStore(s => s.isStreaming);
  const currentSessionKey = useChatStore(s => s.currentSessionKey);
  const loadModels = useAgentStore(s => s.loadModels);

  const {
    drafts,
    readyAttachments,
    uploading,
    failed,
    addFiles,
    clearDrafts,
    removeDraft,
  } = useAgentAttachmentDrafts({
    conversationId: currentSessionKey,
    disabled: isStreaming,
    fallbackName: t('chat.input.attachmentFallbackName'),
  });

  // Load available models on mount
  useEffect(() => { loadModels(); }, [loadModels]);

  // Persist draft text per session key
  useEffect(() => {
    const previousKey = prevSessionKeyRef.current;
    if (previousKey) topicDraftRef.current[previousKey] = input;
    setInput(topicDraftRef.current[currentSessionKey] || '');
    prevSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    if (currentSessionKey) topicDraftRef.current[currentSessionKey] = input;
  }, [currentSessionKey, input]);

  // Auto-resize textarea
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, []);

  useEffect(() => { resizeTextarea(); }, [input, resizeTextarea]);

  // Convert ready attachments to the ChatComposerAttachment shape expected by store
  const toComposerAttachments = useCallback((): ChatComposerAttachment[] =>
    readyAttachments.map((attachment) => ({
      cid: attachment.cid,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: attachment.size,
      attachment,
    })),
  [readyAttachments]);

  const sendDisabled = (!input.trim() && readyAttachments.length === 0) || isStreaming || uploading || failed;

  const handleSend = useCallback(() => {
    const text = input.trim();
    if ((!text && readyAttachments.length === 0) || isStreaming || uploading) return;
    sendMessage(text, toComposerAttachments());
    setInput('');
    clearDrafts();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, readyAttachments.length, isStreaming, uploading, sendMessage, toComposerAttachments, clearDrafts]);

  // Insert text at end of textarea (used by slash action)
  const insertText = useCallback((text: string) => {
    setInput((prev) => `${prev}${text}`);
  }, []);

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFilesSelected = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) addFiles(files);
    event.target.value = '';
  }, [addFiles]);

  // ActionBar context shared with all action items
  const actionContext = useMemo<ActionBarContext>(() => ({
    triggerFileInput,
    insertText,
    textareaRef,
    isStreaming,
  }), [triggerFileInput, insertText, isStreaming]);

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
      <AttachmentStage drafts={drafts} onRemove={removeDraft} />

      <ComposerTextarea
        value={input}
        onChange={setInput}
        onSend={handleSend}
        onResize={resizeTextarea}
        placeholder={placeholder}
        textareaRef={textareaRef}
      />

      <ComposerFooter
        leftActions={leftActions}
        actionContext={actionContext}
        isStreaming={isStreaming}
        sendDisabled={sendDisabled}
        onSend={handleSend}
        onStop={stopStreaming}
      />

      {/* Hidden file input triggered by FileUpload action */}
      <input
        ref={fileInputRef}
        type="file"
        accept={AGENT_ATTACHMENT_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />
    </section>
  );
}
