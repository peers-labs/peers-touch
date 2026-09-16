import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { InputRef } from 'antd';
import { Flexbox } from 'react-layout-kit';
import { ActionIcon, Tag } from '@lobehub/ui';
import { Dropdown, Input, theme } from 'antd';
import type { MenuProps } from 'antd';
import { AlertTriangle, ArrowUp, ChevronDown, ChevronUp, Image as ImageIcon, RefreshCw, Search, ServerCog, Slash, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChatStore, type ChatComposerAttachment } from '../store/chat';
import { useAgentStore } from '../store/agent';
import { useAgentCapabilityStore } from '../store/agentCapabilities';
import {
  projectAgentComposerReadiness,
  type AgentComposerReadinessState,
} from '../store/agentCapabilityReadiness';
import { useMentionStore } from '../store/mentions';
import { AttachmentStage } from './composer/AttachmentStage';
import {
  AGENT_ATTACHMENT_ACCEPT,
  useAgentAttachmentDrafts,
} from './composer/useAgentAttachmentDrafts';
import {
  modelMenuIconStyle,
  modelMenuItemStyle,
  modelMenuLabelStyle,
  modelMenuTextStyle,
} from './composer/modelPickerLayout';
import { useMentionTrigger } from './chat/composer/useMentionTrigger';
import { MentionPopup } from './chat/MentionPopup';
import { MentionTagBar } from './chat/MentionTag';
import {
  isAgentAttachmentRejectedError,
  type AvailableModel,
  type Agent,
} from '../services/desktop_api';
import { ProviderIcon } from './settings/ProviderIcon';
import { selectAgentCapabilityWarning } from './composer/agentCapabilityWarning';
import { removeRejectedInlineReferences } from './composer/invalidReferenceRecovery';
import { log } from '../utils/logger';
import type { AgentCapabilityBinding } from '../gen/proto/domain/agent/capability_pb';

const COMPOSER_COLORS = {
  border: '#d1d1d1',
  borderSoft: '#ececec',
  primaryDisabled: '#d8d3fb',
  textTertiary: '#9b9b9b',
  toolButtonShadow: '0 1px 4px rgba(15,23,42,0.04)',
} as const;

const EMPTY_CAPABILITY_BINDINGS: AgentCapabilityBinding[] = [];

type ComposerReadinessDisplayState =
  | AgentComposerReadinessState
  | 'checking';

function shortSnapshotId(snapshotId: string): string {
  if (!snapshotId) return '';
  return snapshotId.length > 18
    ? `${snapshotId.slice(0, 18)}…`
    : snapshotId;
}

function readinessTagColor(
  state: ComposerReadinessDisplayState,
): 'success' | 'warning' | 'error' | undefined {
  if (state === 'ready') return 'success';
  if (state === 'degraded' || state === 'checking') return 'warning';
  if (
    state === 'unavailable'
    || state === 'blocked'
    || state === 'stale'
  ) {
    return 'error';
  }
  return undefined;
}

// #region debug-point N-Q:context-overflow-composer-owner
function reportContextOverflowComposerDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  return fetch('http://127.0.0.1:7792/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'context-overflow-recovery-locale',
      runId: 'owner-pre-fix',
      hypothesisId,
      location: 'ChatInput.tsx:composer-owner',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).then(() => undefined).catch(() => undefined);
}
// #endregion

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
  const composerReferenceRemoval = useChatStore(s => s.composerReferenceRemoval);
  const composerFocusNonce = useChatStore(s => s.composerFocusNonce);
  const consumeComposerFill = useChatStore(s => s.consumeComposerFill);
  const consumeComposerReferenceRemoval = useChatStore(
    s => s.consumeComposerReferenceRemoval,
  );
  const consumeComposerResourceSelection = useChatStore(
    s => s.consumeComposerResourceSelection,
  );
  const consumeComposerFocus = useChatStore(s => s.consumeComposerFocus);
  const selectedModel = useAgentStore(s => s.selectedModel);
  const selectedProviderId = useAgentStore(s => s.selectedProviderId);
  const selectedAgentName = useAgentStore(s => s.selectedAgent);
  const agents = useAgentStore(s => s.agents);
  const defaultModel = useAgentStore(s => s.defaultModel);
  const availableModels = useAgentStore(s => s.availableModels);
  const setSelectedModel = useAgentStore(s => s.setSelectedModel);
  const selectedAgentData = useMemo(
    () => agents.find((agent) => agent.name === selectedAgentName),
    [agents, selectedAgentName],
  );
  const selectedAgentSaveState = useAgentStore((state) => (
    selectedAgentData
      ? state.saveStateByAgentId[selectedAgentData.id] ?? 'idle'
      : 'idle'
  ));
  const capabilityBindings = useAgentCapabilityStore((state) => (
    selectedAgentData
      ? state.bindingsByAgentId[selectedAgentData.id] ?? EMPTY_CAPABILITY_BINDINGS
      : EMPTY_CAPABILITY_BINDINGS
  ));
  const capabilityReadinessSnapshot = useAgentCapabilityStore((state) => (
    selectedAgentData
      ? state.readinessByAgentId[selectedAgentData.id]
      : undefined
  ));
  const capabilityReadinessLoading = useAgentCapabilityStore((state) => (
    selectedAgentData
      ? Boolean(state.loadingAgentIds[selectedAgentData.id])
      : false
  ));
  const refreshCapabilityReadiness = useAgentCapabilityStore(
    (state) => state.loadAgent,
  );

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
    failed,
    addFiles,
    clearDrafts,
    rejectDraft,
    removeDraft,
    retryDraft,
  } = useAgentAttachmentDrafts({
    conversationId: currentSessionKey,
    disabled: isStreaming,
    fallbackName: t('chat.input.attachmentFallbackName'),
  });
  const currentModelId = selectedModel || defaultModel;
  const modelInfo =
    availableModels.find((model) => model.id === currentModelId && (!selectedProviderId || model.provider_id === selectedProviderId)) ||
    availableModels.find((model) => model.id === currentModelId);
  const composerReadiness = useMemo(
    () => projectAgentComposerReadiness(
      selectedAgentData?.id ?? '',
      selectedAgentData?.version ?? 0,
      capabilityBindings,
      capabilityReadinessSnapshot,
    ),
    [
      capabilityBindings,
      capabilityReadinessSnapshot,
      selectedAgentData?.id,
      selectedAgentData?.version,
    ],
  );
  const readinessDisplayState: ComposerReadinessDisplayState =
    selectedAgentSaveState === 'saving'
    || (!capabilityReadinessSnapshot && capabilityReadinessLoading)
      ? 'checking'
      : composerReadiness.state;
  const readinessCanSend =
    selectedAgentSaveState !== 'saving' && composerReadiness.canSend;
  const capabilityWarning = selectAgentCapabilityWarning(
    capabilityReadinessSnapshot,
    readyAttachments,
  );

  useEffect(() => {
    const previousKey = prevSessionKeyRef.current;
    if (previousKey) topicDraftRef.current[previousKey] = input;
    const restoredDraft = topicDraftRef.current[currentSessionKey] || '';
    // #region debug-point O:context-overflow-session-draft
    void reportContextOverflowComposerDebug('O', 'session-draft-restore', {
      previousSessionPresent: previousKey.length > 0,
      currentSessionPresent: currentSessionKey.length > 0,
      sessionChanged: previousKey !== currentSessionKey,
      restoredDraftLength: restoredDraft.length,
    });
    // #endregion
    setInput(restoredDraft);
    prevSessionKeyRef.current = currentSessionKey;
  }, [currentSessionKey]);

  useEffect(() => {
    if (currentSessionKey) topicDraftRef.current[currentSessionKey] = input;
    // #region debug-point N-P:context-overflow-input-state
    void reportContextOverflowComposerDebug('N-P', 'input-state-committed', {
      currentSessionPresent: currentSessionKey.length > 0,
      inputEmpty: input.length === 0,
      inputLength: input.length,
      storedDraftLength:
        (topicDraftRef.current[currentSessionKey] || '').length,
    });
    // #endregion
  }, [currentSessionKey, input]);

  // I2 follow-up: consume a pending composer-fill request (fill-not-send), aligning
  // with LobeHub `fillInputMessage`. Populate the draft, focus, then clear the request.
  useEffect(() => {
    if (!composerFill) return;
    // #region debug-point N-Q:context-overflow-composer-fill
    void reportContextOverflowComposerDebug('N-Q', 'composer-fill-observed', {
      currentSessionPresent: currentSessionKey.length > 0,
      requestedEmpty: composerFill.text.length === 0,
      requestedLength: composerFill.text.length,
    });
    // #endregion
    setInput(composerFill.text);
    consumeComposerFill();
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const end = composerFill.text.length;
        el.setSelectionRange(end, end);
        // #region debug-point N-P:context-overflow-composer-fill-frame
        void reportContextOverflowComposerDebug(
          'N-P',
          'composer-fill-animation-frame',
          {
            currentNodePresent: true,
            currentNodeConnected: el.isConnected,
            domEmpty: el.value.length === 0,
            domLength: el.value.length,
            requestStillPending:
              useChatStore.getState().composerFill !== null,
          },
        );
        // #endregion
      }
    });
  }, [composerFill, consumeComposerFill]);

  // Invalid references remain composer-owned: remove only the Station-selected
  // inline token after the user invokes recovery, without touching attachments.
  useEffect(() => {
    if (
      !composerReferenceRemoval
      || composerReferenceRemoval.sessionKey !== currentSessionKey
    ) {
      return;
    }
    let active = true;
    const request = composerReferenceRemoval;
    const sourceDraft = input;

    void removeRejectedInlineReferences(
      sourceDraft,
      request.referenceKind,
      request.referenceHash,
    ).then(({ draft }) => {
      if (!active) return;
      consumeComposerReferenceRemoval(request.nonce);
      setInput((current) => current === sourceDraft ? draft : current);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }).catch((error: unknown) => {
      if (!active) return;
      consumeComposerReferenceRemoval(request.nonce);
      log.error('chat', 'Failed to remove invalid inline reference', {
        error: error instanceof Error ? error.message : String(error),
      });
      requestAnimationFrame(() => textareaRef.current?.focus());
    });

    return () => {
      active = false;
    };
  }, [
    composerReferenceRemoval,
    consumeComposerReferenceRemoval,
    currentSessionKey,
    input,
  ]);

  useEffect(() => {
    // Keep the native picker composer-owned. The direct store subscription
    // opens it in the originating user-action stack, then restores the draft
    // focus without retrying or resending the failed Turn.
    const unsubscribeResourceSelection = useChatStore.subscribe((state) => {
      const request = state.composerResourceSelection;
      if (!request || request.sessionKey !== state.currentSessionKey) return;
      consumeComposerResourceSelection(request.nonce);
      fileInputRef.current?.click();
      requestAnimationFrame(() => textareaRef.current?.focus());
    });
    if (composerFocusNonce !== 0) {
      consumeComposerFocus();
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
    return unsubscribeResourceSelection;
  }, [
    composerFocusNonce,
    consumeComposerFocus,
    consumeComposerResourceSelection,
  ]);

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
      cid: attachment.object_ref,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      size: attachment.size_bytes,
      attachment,
    })),
  [readyAttachments]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    const latestAgentState = useAgentStore.getState();
    const latestAgent = latestAgentState.agents.find(
      (agent) => agent.name === latestAgentState.selectedAgent,
    );
    if (!latestAgent) return;
    const latestCapabilityState = useAgentCapabilityStore.getState();
    const latestReadiness = projectAgentComposerReadiness(
      latestAgent.id,
      latestAgent.version,
      latestCapabilityState.bindingsByAgentId[latestAgent.id]
        ?? EMPTY_CAPABILITY_BINDINGS,
      latestCapabilityState.readinessByAgentId[latestAgent.id],
    );
    const latestCapabilityWarning = selectAgentCapabilityWarning(
      latestCapabilityState.readinessByAgentId[latestAgent.id],
      readyAttachments,
    );
    if (
      (!text && readyAttachments.length === 0)
      || isStreaming
      || uploading
      || failed
      || latestAgentState.saveStateByAgentId[latestAgent.id] === 'saving'
      || !latestReadiness.canSend
      || latestCapabilityWarning?.blocking
    ) return;
    sendMessage(text, toComposerAttachments(), {
      onAccepted: () => {
        setInput('');
        clearDrafts(false);
        clearMentions();
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
      },
      onRejected: (error) => {
        if (!isAgentAttachmentRejectedError(error)) return;
        rejectDraft(
          error.details.attachment_id,
          error.locale_key || 'agent.errors.attachmentRejected',
        );
      },
    });
  }, [input, readyAttachments, isStreaming, uploading, failed, sendMessage, toComposerAttachments, clearDrafts, clearMentions, rejectDraft]);

  // Scan the draft for "@" triggers whenever it changes, driving the popup.
  const handleInputChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    // #region debug-point Q:context-overflow-native-input
    void reportContextOverflowComposerDebug('Q', 'native-input-observed', {
      nextEmpty: value.length === 0,
      nextLength: value.length,
    });
    // #endregion
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
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [addFiles]);

  const currentModelKey = modelInfo ? modelMenuKey(modelInfo) : currentModelId;
  const sendDisabled =
    (!input.trim() && readyAttachments.length === 0)
    || isStreaming
    || uploading
    || failed
    || !readinessCanSend
    || Boolean(capabilityWarning?.blocking);

  const modelDisplayName = modelInfo?.display_name || modelInfo?.id || currentModelId;
  const modelLabel = modelInfo
    ? modelDisplayName
    : currentModelId || t('chat.model.select');
  const providerLabel =
    selectedAgentData?.provider
    || selectedProviderId
    || modelInfo?.provider_name
    || modelInfo?.provider_id
    || t('chat.input.runtimeSnapshot.unknown');
  const runtimeSnapshotLabel = shortSnapshotId(
    composerReadiness.runtimeSnapshotId,
  ) || t('chat.input.runtimeSnapshot.unknown');
  const readinessReasonKey = selectedAgentSaveState === 'saving'
    ? 'checking'
    : composerReadiness.state;

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
          style: modelMenuItemStyle,
          label: (
            <Flexbox horizontal align="center" gap={8} style={modelMenuLabelStyle}>
              <span style={modelMenuIconStyle}>
                <ProviderIcon
                  providerId={model.provider_id || ''}
                  providerName={model.provider_name}
                  size={18}
                />
              </span>
              <span title={model.display_name || model.id} style={modelMenuTextStyle}>
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
      <AttachmentStage drafts={drafts} onRemove={removeDraft} onRetry={retryDraft} />

      <Flexbox
        data-pt-agent-runtime-snapshot={
          composerReadiness.runtimeSnapshotId || 'unknown'
        }
        data-pt-agent-readiness-snapshot={
          composerReadiness.snapshotId || 'unknown'
        }
        data-pt-agent-readiness-state={readinessDisplayState}
        data-pt-agent-model-compatibility={composerReadiness.compatibility}
        data-pt-agent-selected-provider={selectedAgentData?.provider || 'unknown'}
        data-pt-agent-selected-model={selectedAgentData?.model || 'unknown'}
        data-pt-agent-readiness-authority={composerReadiness.authority}
        data-pt-agent-readiness-reason={composerReadiness.reasonCode}
        horizontal
        align="center"
        gap={7}
        aria-live="polite"
        style={{
          minWidth: 0,
          borderRadius: token.borderRadiusSM,
          background: token.colorFillQuaternary,
          color: token.colorTextSecondary,
          fontSize: 11,
          padding: '5px 8px',
        }}
      >
        <ServerCog size={14} style={{ flexShrink: 0 }} />
        <span
          title={`${providerLabel} / ${modelLabel}`}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t('chat.input.runtimeSnapshot.selection', {
            model: modelLabel,
            provider: providerLabel,
          })}
        </span>
        <span aria-hidden style={{ color: token.colorTextQuaternary }}>·</span>
        <span
          title={composerReadiness.runtimeSnapshotId}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {t('chat.input.runtimeSnapshot.snapshot', {
            snapshot: runtimeSnapshotLabel,
          })}
        </span>
        <Tag color={readinessTagColor(readinessDisplayState)} style={{ margin: 0 }}>
          {t(`chat.input.runtimeSnapshot.state.${readinessDisplayState}`)}
        </Tag>
      </Flexbox>

      {!readinessCanSend && (
        <Flexbox
          data-pt-agent-readiness-blocking={readinessDisplayState}
          horizontal
          align="center"
          gap={6}
          style={{
            color: token.colorErrorText,
            background: token.colorErrorBg,
            border: `1px solid ${token.colorErrorBorder}`,
            borderRadius: token.borderRadiusSM,
            fontSize: 12,
            padding: '6px 8px',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            {t(`chat.input.runtimeSnapshot.blocked.${readinessReasonKey}`)}
          </span>
          {selectedAgentData ? (
            <ActionIcon
              data-pt-agent-readiness-refresh
              icon={RefreshCw}
              aria-label={t('chat.input.runtimeSnapshot.refresh')}
              title={t('chat.input.runtimeSnapshot.refresh')}
              loading={capabilityReadinessLoading}
              onClick={() => {
                void refreshCapabilityReadiness(selectedAgentData.id)
                  .catch(() => undefined);
              }}
              size={{ blockSize: 26, size: 13 }}
            />
          ) : null}
        </Flexbox>
      )}

      {readinessErrorKey && (
        <div style={{ color: token.colorError, fontSize: 12 }}>
          {t(readinessErrorKey)}
        </div>
      )}

      {capabilityWarning && (
        <Flexbox
          data-agent-capability-warning={capabilityWarning.kind}
          horizontal
          align="center"
          gap={6}
          style={{
            color: token.colorWarningText,
            background: token.colorWarningBg,
            border: `1px solid ${token.colorWarningBorder}`,
            borderRadius: token.borderRadiusSM,
            fontSize: 12,
            padding: '6px 8px',
          }}
        >
          <AlertTriangle size={14} style={{ flexShrink: 0 }} />
          <span>{t(capabilityWarning.messageKey)}</span>
        </Flexbox>
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
              <span style={modelMenuIconStyle}>
                <ProviderIcon
                  providerId={modelInfo.provider_id || ''}
                  providerName={modelInfo.provider_name}
                  size={16}
                />
              </span>
              )}
            <span title={modelLabel} style={{ ...modelMenuTextStyle, lineHeight: 1 }}>{modelLabel}</span>
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
        data-pt-agent-attachment-input
        data-pt-agent-resource-picker
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
