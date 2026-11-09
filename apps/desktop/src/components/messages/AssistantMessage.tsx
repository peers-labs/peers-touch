import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Button, Dialog } from '@peers-touch/ui';
import {
  Copy,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  FileText,
  Brain,
  Cpu,
  Activity,
  Download,
  Play,
  Code2,
  Braces,
  Workflow,
  ExternalLink,
  ListOrdered,
  LogOut,
  Minimize2,
  RotateCcw,
  Settings,
  X,
  Ban,
} from 'lucide-react';
import type { ChatMessage, DelegationTaskInfo, MessageArtifact } from '../../store/chat';
import { extractMessageArtifacts, useChatStore } from '../../store/chat';
import { useAgentStore } from '../../store/agent';
import { useAgentTopicStore } from '../../store/agentTopics';
import { usePortalStore } from '../../store/portal';
import {
  api,
  isAgentContextOverflowError,
} from '../../services/desktop_api';
import { EVENT, eventBus } from '../../kernel/events';
import { identityRuntime } from '../../kernel/identityRuntime';
import { LazyMarkdown as Markdown } from '../LazyMarkdown';
import { AgentIconTile } from '../agent/AgentIconTile';
import { ProviderIcon } from '../settings/ProviderIcon';
import { useTranslation } from 'react-i18next';
import { MessageActionBar } from '../messages';
import { ForwardMessageModal } from './ForwardMessageModal';
import { ToolCallsBlock } from './ToolCallCard';
import { TurnArtifactBar } from './TurnArtifactBar';
import { ThinkingIndicator } from './ThinkingBlock';
import { timeAgo, fullTime, downloadCodeBlock, downloadArtifact } from './shared';
import { TurnAttribution } from './TurnAttribution';
import { notifySuccess, notifyError } from '../../ui/feedback';

// --- Collect delegation results from message + tool calls ---

function collectDelegationResults(message: ChatMessage): DelegationTaskInfo[] {
  const fromMessage = message.delegationResults || [];
  const fromTools = (message.toolCalls || []).flatMap((tool) => tool.delegationResults || []);
  const byId = new Map<string, DelegationTaskInfo>();
  [...fromMessage, ...fromTools].forEach((result) => {
    byId.set(result.taskId, result);
  });
  return Array.from(byId.values());
}

// --- Artifact helpers ---

function ArtifactIcon({ kind }: { kind: MessageArtifact['kind'] }) {
  if (kind === 'diagram') return <Workflow size={14} />;
  if (kind === 'structured') return <Braces size={14} />;
  if (kind === 'code') return <Code2 size={14} />;
  return <FileText size={14} />;
}

function artifactTypeKey(kind: MessageArtifact['kind']): string {
  return `chat.message.artifact.kind.${kind}`;
}

function ArtifactBlock({
  artifacts,
  onOpenArtifact,
}: {
  artifacts: MessageArtifact[];
  onOpenArtifact?: (artifact: MessageArtifact) => void;
}) {
  const { t } = useTranslation('chat');

  const handleCopy = useCallback((artifact: MessageArtifact) => {
    navigator.clipboard.writeText(artifact.content).then(() => {
      notifySuccess(t('chat.message.toast.artifactCopied'));
    });
  }, [t]);

  const handleExport = useCallback((artifact: MessageArtifact) => {
    downloadArtifact(artifact);
    notifySuccess(t('chat.message.toast.artifactExported'));
  }, [t]);

  return (
    <div className="sc-artifact-block">
      <div className="sc-artifact-block__head">
        <FileText size={14} className="sc-artifact-block__head-icon" />
        <span className="sc-artifact-block__title">
          {t('chat.message.artifact.title')}
        </span>
        <span className="sc-tool-tag">
          {t('chat.message.artifact.count', { count: artifacts.length })}
        </span>
      </div>
      <div className="sc-artifact-block__list">
        {artifacts.map((artifact, index) => (
          <div key={artifact.id} className="sc-artifact-block__row">
            <span className="sc-artifact-block__row-icon">
              <ArtifactIcon kind={artifact.kind} />
            </span>
            <div className="sc-artifact-block__row-body">
              <span className="sc-artifact-block__row-title">
                {t('chat.message.artifact.itemTitle', {
                  type: t(artifactTypeKey(artifact.kind)),
                  index: index + 1,
                  language: artifact.language || t('chat.message.code.plainText'),
                })}
              </span>
              <span className="sc-artifact-block__row-source">
                {t('chat.message.artifact.sourceMessage', { id: artifact.messageId.slice(0, 8) })}
              </span>
            </div>
            <div className="sc-artifact-block__actions">
              {onOpenArtifact && (
                <Button
                  actionId={`artifact-open-${artifact.id}`}
                  emphasis="quiet"
                  density="compact"
                  leading={<ExternalLink size={14} />}
                  label={t('chat.message.artifact.open')}
                  onActivate={() => onOpenArtifact(artifact)}
                />
              )}
              <Button
                actionId={`artifact-copy-${artifact.id}`}
                emphasis="quiet"
                density="compact"
                leading={<Copy size={14} />}
                label={t('chat.message.artifact.copy')}
                onActivate={() => handleCopy(artifact)}
              />
              <Button
                actionId={`artifact-export-${artifact.id}`}
                emphasis="quiet"
                density="compact"
                leading={<Download size={14} />}
                label={t('chat.message.artifact.export')}
                onActivate={() => handleExport(artifact)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Diagnostics row ---

function DiagnosticsRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="sc-diag-row">
      <span className="sc-diag-row__label">{label}</span>
      <span className="sc-diag-row__value">{value}</span>
    </div>
  );
}

// --- Diagnostics block ---

function DiagnosticsBlock({
  message,
  providerName,
}: {
  message: ChatMessage;
  providerName: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation(['chat', 'agent']);
  const toolCalls = message.toolCalls || [];
  const delegationResults = collectDelegationResults(message);
  const failedTools = toolCalls.filter((tool) => tool.status === 'error' || tool.status === 'denied').length;
  const pendingTools = toolCalls.filter((tool) => tool.pending || tool.status === 'approval_required').length;
  const failedDelegations = delegationResults.filter((item) => item.status === 'failed' || item.status === 'timeout').length;
  // A user-cancelled turn owns one dedicated surface (the stopped banner with
  // retry); never render its cancellation reason as a generic failure.
  const diagnosticError = message.typedError?.error_type === 'LIFECYCLE_CANCELLED'
    ? undefined
    : message.error;
  const presentedError = diagnosticError
    ? diagnosticError.startsWith('agent.')
      ? t(diagnosticError, { ns: 'agent', defaultValue: diagnosticError })
      : t(diagnosticError, { defaultValue: diagnosticError })
    : undefined;
  const hasRuntimeDiagnostics = !!message.thinking || !!diagnosticError || message.processDuration != null || toolCalls.length > 0 || delegationResults.length > 0;
  const hasDiagnostics = hasRuntimeDiagnostics;

  if (!hasDiagnostics) return null;

  return (
    <div
      className={`sc-diag${diagnosticError ? ' is-error' : ''}`}
      data-pt-agent-message-error={diagnosticError}
      data-pt-agent-error-type={message.typedError?.error_type}
      data-pt-agent-error-reason-code={message.typedError?.details.reason_code}
    >
      <button
        type="button"
        className="sc-diag__toggle"
        data-pt-agent-message-error-toggle={diagnosticError ? 'true' : undefined}
        data-pt-agent-activity-toggle
        aria-expanded={expanded}
        aria-label={message.error ? t('chat.message.errorTitle', { defaultValue: 'Could not complete' }) : t('chat.message.diagnostics.title')}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {diagnosticError ? <AlertTriangle size={13} /> : <Activity size={13} />}
        <span>{diagnosticError ? t('chat.message.errorTitle', { defaultValue: 'Could not complete' }) : t('chat.message.diagnostics.title')}</span>
        {message.processDuration != null && (
          <span className="sc-diag__duration sc-tool-tag">
            {t('chat.message.diagnostics.duration', { seconds: message.processDuration })}
          </span>
        )}
      </button>
      {expanded && (
        <div className="sc-diag__body">
          {diagnosticError && (
            <div className="sc-diag__error">
              <span className="sc-diag__error-title">{t('chat.message.diagnostics.error')}</span>
              <span
                className="sc-diag__error-text"
                data-pt-agent-message-error-text={diagnosticError}
              >
                {presentedError}
              </span>
            </div>
          )}
          {message.thinking && (
            <div className="sc-diag__thinking">
              <div className="sc-diag__thinking-head">
                <Brain size={13} className="sc-diag__thinking-icon" />
                <span className="sc-diag__thinking-title">{t('chat.message.diagnostics.thinking')}</span>
                <span className={`sc-tool-tag${message.thinkingDone ? ' is-success' : ' is-processing'}`}>
                  {message.thinkingDone ? t('chat.message.thinking.done') : t('chat.message.thinking.thinking')}
                </span>
              </div>
              <pre className="sc-diag__thinking-pre">{message.thinking}</pre>
            </div>
          )}
          <DiagnosticsRow
            label={t('chat.message.diagnostics.provider')}
            value={<span className="sc-diag__provider"><Cpu size={12} />{providerName || t('chat.message.diagnostics.unknown')}</span>}
          />
          <DiagnosticsRow label={t('chat.message.diagnostics.model')} value={message.model || t('chat.message.diagnostics.unknown')} />
          <DiagnosticsRow label={t('chat.message.diagnostics.tools')} value={t('chat.message.diagnostics.toolSummary', { total: toolCalls.length, pending: pendingTools, failed: failedTools })} />
          <DiagnosticsRow
            label={t('chat.message.diagnostics.delegation')}
            value={delegationResults.length > 0
              ? (
                <span className="sc-diag__delegation">
                  <span>{t('chat.message.diagnostics.delegationSummary', { total: delegationResults.length, failed: failedDelegations })}</span>
                  {delegationResults.slice(0, 3).map((result) => (
                    <span key={result.taskId} className="sc-diag__delegation-item">
                      {result.taskDescription} · {t(`chat.message.delegation.status.${result.status}`)}
                    </span>
                  ))}
                </span>
              )
              : t('chat.message.diagnostics.none')}
          />
        </div>
      )}
    </div>
  );
}

// --- AssistantMessage props ---

interface AssistantMessageProps {
  message: ChatMessage;
  onOpenArtifact?: (artifact: MessageArtifact) => void;
}

/**
 * Renders a complete assistant message including diagnostics, tool calls,
 * artifacts, markdown content, error display, and the action bar.
 */
export function AssistantMessage({ message, onOpenArtifact }: AssistantMessageProps) {
  const { t } = useTranslation(['chat', 'agent']);
  const presentedError = message.error
    ? message.error.startsWith('agent.')
      ? t(message.error, { ns: 'agent', defaultValue: message.error })
      : t(message.error, { ns: 'chat', defaultValue: message.error })
    : undefined;
  const [hovered, setHovered] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);

  const branchFromMessage = useChatStore(s => s.branchFromMessage);
  const continueGeneration = useChatStore(s => s.continueGeneration);
  const deleteAndRegenerateMessage = useChatStore(s => s.deleteAndRegenerateMessage);
  const deleteMessage = useChatStore(s => s.deleteMessage);
  const regenerateMessage = useChatStore(s => s.regenerateMessage);
  const retryMessage = useChatStore(s => s.retryMessage);
  const retryTurnRecovery = useChatStore(s => s.retryTurnRecovery);
  const reloadTurnSnapshot = useChatStore(s => s.reloadTurnSnapshot);
  const resetExternalRuntime = useChatStore(s => s.resetExternalRuntime);
  const reconcileClientLease = useChatStore(s => s.reconcileClientLease);
  const requestComposerFocus = useChatStore(s => s.requestComposerFocus);
  const requestComposerModelSelection = useChatStore(s => s.requestComposerModelSelection);
  const syncTurnQueue = useChatStore(s => s.syncTurnQueue);
  const requestComposerReferenceRemoval = useChatStore(
    s => s.requestComposerReferenceRemoval,
  );
  const requestComposerResourceSelection = useChatStore(
    s => s.requestComposerResourceSelection,
  );
  const sendMessage = useChatStore(s => s.sendMessage);
  const translateMessage = useChatStore(s => s.translateMessage);
  const openThread = usePortalStore(s => s.openThread);
  const currentSessionKey = useChatStore(s => s.currentSessionKey);
  const operation = useChatStore((state) => {
    // The owning operation can sit under the session key or under a parallel
    // operation key when two turns are active; match by the optimistic message
    // id or the stamped turn id instead of trusting one storage key.
    return Object.values(state.operations).find((candidate) => (
      candidate.sessionKey === state.currentSessionKey
      && (
        candidate.assistantMessageId === message.id
        || (Boolean(message.turnId) && candidate.turnId === message.turnId)
      )
    ));
  });
  // Turn-level chips (artifact bar, attribution) belong once per turn: a
  // multi-iteration turn persists several assistant rows, so render them only
  // on the final assistant node for that turn.
  const isTurnTail = useChatStore((state) => {
    if (!message.turnId) return true;
    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      const candidate = state.messages[index];
      if (candidate.role === 'assistant' && candidate.turnId === message.turnId) {
        return candidate.id === message.id;
      }
    }
    return true;
  });
  const agents = useAgentStore(s => s.agents);
  const availableModels = useAgentStore(s => s.availableModels);
  const selectedAgent = useAgentStore(s => s.selectedAgent);
  const setAgentSurface = useAgentStore(s => s.setAgentSurface);
  const focusAgentCapability = useAgentStore(s => s.focusAgentCapability);
  const activeAgent = agents.find((agent) => agent.name === selectedAgent);
  const topicProvider = useAgentTopicStore((state) => Object.values(state.topicsByAgentId)
    .flat().find((topic) => topic.key === currentSessionKey)?.provider_override);
  const messageProvider = message.providerId || topicProvider || '';
  const messageModel = message.model
    ? availableModels.find(
      (model) =>
        model.id === message.model
        && model.provider_id === messageProvider,
    )
    : undefined;
  const providerName = messageModel?.provider_name || messageModel?.provider_id || messageProvider;
  const agentDisplayName = activeAgent?.title || activeAgent?.name;
  const isContextOverflow = isAgentContextOverflowError(message.typedError);
  const resolutionLabel = message.resolution?.label.startsWith('agent.')
    ? t(message.resolution.label, { ns: 'agent' })
    : message.resolution?.label;
  const resolutionTarget = message.resolution?.type === 'openProviderSettings'
    ? 'configure-credential'
    : message.resolution?.type === 'openOriginal'
      ? 'open-original'
      : message.resolution?.type === 'openResult'
        ? 'open-result'
      : message.resolution?.type === 'editQueue'
        ? 'edit-queue'
        : message.resolution?.type === 'selectRuntime'
          ? 'select-runtime'
        : message.resolution?.type === 'confirmReset'
          ? 'confirm-reset'
        : message.resolution?.type === 'openPermissionSettings'
          ? 'open-permission-settings'
        : message.resolution?.type === 'retryLater'
          ? 'retry-later'
        : message.resolution?.type === 'retry'
          ? 'retry'
        : message.resolution?.type === 'inspectBudget'
          ? 'inspect-budget'
        : message.resolution?.type === 'switchAccount'
          ? 'switch-account'
        : message.resolution?.type === 'chooseCompatibleModel'
          ? 'choose-compatible-model'
          : message.resolution?.type === 'chooseTool'
            ? 'choose-tool'
          : message.resolution?.type === 'recover'
            ? 'recover'
            : message.resolution?.type === 'reconcile'
              ? 'reconcile'
            : message.resolution?.type === 'chooseResourceAgain'
              ? 'choose-resource-again'
            : message.resolution?.type === 'removeReference'
              ? 'remove-reference'
            : 'true';
  const artifacts = useMemo(() => extractMessageArtifacts(message), [message]);

  const handleCopy = useCallback(() => {
    let text = message.content;
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolText = message.toolCalls
        .map((tc) => {
          let s = `\n---\n**Tool: ${tc.name}**`;
          if (tc.args) s += `\nArguments: \`${tc.args}\``;
          if (tc.result) s += `\nResult:\n${tc.result}`;
          return s;
        })
        .join('\n');
      text = toolText + '\n\n' + text;
    }
    navigator.clipboard.writeText(text).then(() => {
      notifySuccess(t('chat.message.toast.copied'));
    });
  }, [message.content, message.toolCalls, t]);

  const handleRegenerate = useCallback(() => {
    regenerateMessage(message.id);
  }, [regenerateMessage, message.id]);

  const handleRetry = useCallback(() => {
    return retryMessage(message.id);
  }, [retryMessage, message.id]);

  const handleRetryRecovery = useCallback(() => {
    retryTurnRecovery(currentSessionKey);
  }, [currentSessionKey, retryTurnRecovery]);

  const handleReloadSnapshot = useCallback(() => {
    void reloadTurnSnapshot(currentSessionKey);
  }, [currentSessionKey, reloadTurnSnapshot]);

  const handleReconcileClientLease = useCallback(() => {
    const resolution = message.resolution;
    if (resolution?.type !== 'reconcile') return Promise.resolve();
    if (!resolution.sessionId || !resolution.leaseId) {
      throw new Error('agent.errors.clientLeaseExpired');
    }
    return reconcileClientLease(
      currentSessionKey,
      message.id,
      resolution.sessionId,
      resolution.leaseId,
      message.turnId,
    );
  }, [
    currentSessionKey,
    message.id,
    message.resolution,
    message.turnId,
    reconcileClientLease,
  ]);

  const handleEditQueue = useCallback(async () => {
    const resolution = message.resolution;
    if (
      resolution?.type !== 'editQueue'
      || !resolution.conversationId
      || resolution.conversationId !== currentSessionKey
    ) {
      throw new Error('agent.errors.queueFull');
    }
    await syncTurnQueue(resolution.conversationId);
    const tray = Array.from(
      document.querySelectorAll<HTMLElement>('[data-pt-agent-turn-queue]'),
    ).find((candidate) => (
      candidate.dataset.ptAgentTurnQueue === resolution.conversationId
      && candidate.getClientRects().length > 0
    ));
    if (!tray) {
      throw new Error('agent.errors.queueFull');
    }
    tray.scrollIntoView({ block: 'nearest' });
    tray.focus({ preventScroll: true });
  }, [currentSessionKey, message.resolution, syncTurnQueue]);

  const handleInspectBudget = useCallback(() => {
    const resolution = message.resolution;
    if (
      resolution?.type !== 'inspectBudget'
      || !resolution.turnId
      || resolution.turnId !== message.turnId
    ) {
      notifyError(t('chat.message.turnDetails.loadFailed'));
      return;
    }
    const notice = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-pt-agent-message-id] [data-budget-kind]',
    )).find((candidate) => (
      candidate.closest<HTMLElement>('[data-pt-agent-message-id]')
        ?.dataset.ptAgentMessageId === message.id
    ));
    if (!notice) {
      notifyError(t('chat.message.turnDetails.loadFailed'));
      return;
    }
    notice.scrollIntoView({ block: 'nearest' });
    notice.tabIndex = -1;
    notice.focus({ preventScroll: true });
  }, [message.id, message.resolution, message.turnId, t]);

  const handleOpenResult = useCallback(() => {
    const resolution = message.resolution;
    if (
      resolution?.type !== 'openResult'
      || !resolution.turnId
      || resolution.turnId !== message.turnId
      || resolution.terminalStatus !== message.terminalStatus
    ) {
      notifyError(t('chat.message.turnDetails.loadFailed'));
      return;
    }
    const result = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-pt-agent-message-id]',
    )).find((candidate) => candidate.dataset.ptAgentMessageId === message.id);
    if (!result) {
      notifyError(t('chat.message.turnDetails.loadFailed'));
      return;
    }
    result.scrollIntoView({ block: 'nearest' });
    result.tabIndex = -1;
    result.focus({ preventScroll: true });
  }, [
    message.id,
    message.resolution,
    message.terminalStatus,
    message.turnId,
    t,
  ]);

  const handleOpenOriginal = useCallback((turnId: string) => {
    const originalMessage = useChatStore.getState().messages.find(
      (candidate) => (
        candidate.role === 'assistant'
        && candidate.turnId === turnId
        && candidate.id !== message.id
      ),
    );
    if (!originalMessage) {
      notifyError(t('chat.message.turnDetails.loadFailed'));
      return;
    }
    const original = Array.from(document.querySelectorAll<HTMLElement>(
      '[data-pt-agent-message-id]',
    )).find((candidate) => candidate.dataset.ptAgentMessageId === originalMessage.id);
    if (!original) {
      notifyError(t('chat.message.turnDetails.loadFailed'));
      return;
    }
    original.scrollIntoView({ block: 'nearest' });
    original.tabIndex = -1;
    original.focus({ preventScroll: true });
  }, [message.id, t]);

  const handleChooseCompatibleModel = useCallback(() => {
    if (!currentSessionKey || !useChatStore.getState().messages.some((candidate) => candidate.id === message.id)) {
      notifyError(t('chat.message.resolution.actionFailed'));
      return;
    }
    requestComposerModelSelection(currentSessionKey);
  }, [currentSessionKey, message.id, requestComposerModelSelection, t]);

  const handleOpenPermissionSettings = useCallback(() => {
    const resolution = message.resolution;
    if (
      !activeAgent
      || resolution?.type !== 'openPermissionSettings'
      || !resolution.capabilityId
      || !resolution.permissionKind
    ) {
      notifyError(t('chat.message.resolution.actionFailed'));
      return;
    }
    focusAgentCapability(
      activeAgent.name,
      resolution.capabilityId,
      resolution.permissionKind,
    );
    setAgentSurface(activeAgent.name, 'profile');
    eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
  }, [
    activeAgent,
    focusAgentCapability,
    message.resolution,
    setAgentSurface,
    t,
  ]);

  const handleConfirmRuntimeReset = useCallback(() => {
    const resolution = message.resolution;
    if (
      resolution?.type !== 'confirmReset'
      || !resolution.runtimeProfileId
    ) {
      notifyError(t('chat.message.resolution.actionFailed'));
      return;
    }
    // Destructive action: open the peer confirm dialog (FeedbackHost) instead
    // of dispatching the reset immediately. The confirm button carries the
    // acceptance anchor and performs the guarded runtime reset.
    setResetConfirmOpen(true);
  }, [
    message.resolution,
    t,
  ]);

  const performRuntimeReset = useCallback(async () => {
    try {
      await resetExternalRuntime(currentSessionKey);
      notifySuccess(
        t('agent.recovery.runtimeResetCompleted', { ns: 'agent' }),
      );
    } catch (error) {
      const messageText = error instanceof Error
        ? error.message
        : String(error);
      notifyError(
        messageText || t('chat.message.resolution.actionFailed'),
      );
      throw error;
    }
  }, [currentSessionKey, resetExternalRuntime, t]);

  const handleDelAndRegenerate = useCallback(() => {
    deleteAndRegenerateMessage(message.id);
  }, [deleteAndRegenerateMessage, message.id]);

  const handleBranch = useCallback(() => {
    void branchFromMessage(message.id);
  }, [branchFromMessage, message.id]);

  const handleDelete = useCallback(() => {
    deleteMessage(message.id);
  }, [deleteMessage, message.id]);

  const handleExportCodeBlock = useCallback((content: string, language: string) => {
    downloadCodeBlock(content, language);
    notifySuccess(t('chat.message.toast.codeExported'));
  }, [t]);

  const handleRunCodeBlock = useCallback((content: string, language: string) => {
    sendMessage(t('chat.message.code.runPrompt', {
      code: content,
      language: language || t('chat.message.code.plainText'),
    }));
  }, [sendMessage, t]);

  // #region debug-point R-T:lease-expired-message-render
  useEffect(() => {
    if (
      import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1'
      || (
        message.typedError?.error_type !== 'CLIENT_LEASE_EXPIRED'
        && !message.toolCalls?.some(
          (toolCall) => toolCall.name === 'local_clipboard_read',
        )
      )
    ) {
      return;
    }
    void fetch('http://127.0.0.1:7777/event', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: 'lease-approval-stall',
        runId: 'post-ui-projection-fix',
        hypothesisId: 'R-T',
        location: 'components/messages/AssistantMessage.tsx:render-projection',
        msg: '[DEBUG] Assistant message render projection observed',
        data: {
          messageId: message.id,
          role: message.role,
          turnId: message.turnId ?? null,
          error: message.error ?? null,
          errorType: message.typedError?.error_type ?? null,
          resolution: message.resolution?.type ?? null,
          loading: message.loading === true,
          terminalStatus: message.terminalStatus ?? null,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
  }, [
    message.error,
    message.id,
    message.loading,
    message.resolution,
    message.role,
    message.terminalStatus,
    message.toolCalls,
    message.turnId,
    message.typedError,
  ]);
  // #endregion

  return (
    <div
      className={`sc-assistant-message${hovered ? ' is-hovered' : ''}`}
      data-pt-agent-message="assistant"
      data-pt-agent-message-id={message.id}
      data-pt-turn-tail={isTurnTail ? 'true' : 'false'}
      data-pt-agent-operation-status={
        message.loading || message.queued
          ? (operation?.runState ?? (message.queued ? 'queued' : 'streaming'))
          : undefined
      }
      data-pt-agent-turn-id={message.turnId}
      data-pt-agent-terminal-status={message.terminalStatus}
      data-pt-agent-error-type={message.typedError?.error_type}
      data-pt-agent-error-resource-kind={message.typedError?.details.resource_kind}
      data-pt-agent-error-resource-ref-hash={message.typedError?.details.resource_ref_hash}
      data-pt-agent-error-resource-id={message.typedError?.details.resource_id}
      data-pt-agent-error-terminal-status={message.typedError?.details.terminal_status}
      data-pt-agent-error-capability-id={message.typedError?.details.capability_id}
      data-pt-agent-error-permission-kind={message.typedError?.details.permission_kind}
      data-pt-agent-error-turn-id={message.typedError?.details.turn_id}
      data-pt-agent-error-reason-code={message.typedError?.details.reason_code}
      data-pt-agent-error-runtime-kind={message.typedError?.details.runtime_kind}
      data-pt-agent-error-runtime-profile-id={message.typedError?.details.runtime_profile_id}
      data-pt-agent-error-provider-id={message.typedError?.details.provider_id}
      data-pt-agent-error-model-id={message.typedError?.details.model_id}
      data-pt-agent-error-deadline={message.typedError?.details.deadline}
      data-pt-agent-error-retry-after-ms={message.typedError?.details.retry_after_ms}
      data-pt-agent-error-tool-id={message.typedError?.details.tool_id}
      data-pt-agent-error-tool-version={message.typedError?.details.tool_version}
      data-pt-agent-error-budget-kind={message.typedError?.details.budget_kind}
      data-pt-agent-error-budget-limit={message.typedError?.details.limit}
      data-pt-agent-error-reference-kind={message.typedError?.details.reference_kind}
      data-pt-agent-error-reference-hash={message.typedError?.details.reference_hash}
      data-pt-agent-error-session-id={message.typedError?.details.session_id}
      data-pt-agent-error-lease-id={message.typedError?.details.lease_id}
      data-pt-agent-error-expired-at={message.typedError?.details.expired_at}
      id={`agent-message-${message.id}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Header: avatar + name + model + timestamp */}
      <div className="sc-assistant-message__head">
        <AgentIconTile size={32} />
        <strong className="sc-assistant-message__name">
          {agentDisplayName || t('chat.message.assistant')}
        </strong>
        {message.model && !message.loading && (
          <span className="sc-assistant-message__model">
            {messageModel && (
              <ProviderIcon
                providerId={messageModel.provider_id || ''}
                providerName={messageModel.provider_name}
                size={11}
              />
            )}
            <span className="sc-assistant-message__model-name">
              {messageModel?.display_name || message.model}
            </span>
          </span>
        )}
        <span
          className="sc-assistant-message__time"
          title={fullTime(message.timestamp)}
        >
          {timeAgo(message.timestamp, t)}
        </span>
      </div>

      {/* Message body */}
      <div className="sc-assistant-message__body">
        <div className="sc-assistant-message__content">
          <DiagnosticsBlock
            message={message}
            providerName={providerName}
          />

          {message.budgetNotice && (
            <div
              className="sc-budget-notice"
              data-budget-notice
              data-budget-kind={message.budgetNotice.kind}
            >
              <div className="sc-budget-notice__head">
                <AlertTriangle size={14} />
                <strong>{t('chat.message.budget.title')}</strong>
              </div>
              <span className="sc-budget-notice__text">
                {t(`chat.message.budget.kind.${message.budgetNotice.kind}`, {
                  limit: message.budgetNotice.limit,
                })}
              </span>
              {message.resolution?.type === 'inspectBudget' && (
                <Button
                  actionId="assistant-inspect-budget"
                  data-pt-agent-message-error-recovery="inspect-budget"
                  emphasis="primary"
                  density="compact"
                  leading={<Activity size={14} />}
                  label={resolutionLabel}
                  onActivate={handleInspectBudget}
                />
              )}
            </div>
          )}

          {/* Tool calls block */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <ToolCallsBlock
              toolCalls={message.toolCalls}
              messageId={message.id}
              turnId={message.turnId}
              onRequestAgain={handleRetry}
            />
          )}

          {/* User-stopped turn: neutral terminal notice (not an error) with an
              explicit retry that re-runs the turn's original user input. */}
          {message.terminalStatus === 'cancelled' && !message.loading && (
            <div
              className="sc-turn-stopped"
              data-pt-agent-turn-stopped
            >
              <Ban size={14} className="sc-turn-stopped__icon" />
              <strong>{t('chat.message.turnStopped')}</strong>
              <Button
                actionId="assistant-turn-stopped-retry"
                className="sc-turn-stopped__retry"
                emphasis="quiet"
                density="compact"
                leading={<RotateCcw size={13} />}
                label={t('chat.message.turnStopped.retry')}
                onActivate={handleRetry}
              />
            </div>
          )}

          {/* Real Station-persisted file artifacts produced by this turn.
              Render once per turn: only its final assistant node. */}
          {isTurnTail && <TurnArtifactBar turnId={message.turnId} />}

          {/* In-message code-block artifacts */}
          {artifacts.length > 0 && (
            <ArtifactBlock artifacts={artifacts} onOpenArtifact={onOpenArtifact} />
          )}

          {/* Progress remains visible while content and tools are streaming,
              including reconnects after partial output has arrived. */}
          {message.loading && !message.queued && (
            <ThinkingIndicator
              runState={operation?.runState ?? 'streaming'}
              startedAt={operation?.startedAt ?? null}
            />
          )}

          {/* Content area */}
          {message.queued ? (
            <div
              className="sc-assistant-message__queued"
              data-pt-agent-message-queued
              data-pt-agent-message-queue-entry={message.queueEntryId}
            >
              <button
                type="button"
                className="sc-tool-tag sc-assistant-message__queue-tag"
                title={t('chat.queue.showInQueue')}
                onClick={() => {
                  document
                    .querySelector('[data-pt-agent-turn-queue]')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                {t('chat.queue.position', { position: message.queuePosition })}
              </button>
              <span>{t('chat.queue.waiting')}</span>
            </div>
          ) : collapsed ? (
            <button
              type="button"
              className="sc-assistant-message__collapsed"
              onClick={() => setCollapsed(false)}
            >
              {t('chat.message.collapsed')}
            </button>
          ) : message.content ? (
            <div className="selectable">
              <Markdown
                content={message.content}
                streaming={message.loading}
                style={{ fontSize: 14 }}
                codeActions={(block) => (
                  <span className="sc-code-actions">
                    <Button
                      actionId="code-block-export"
                      emphasis="quiet"
                      density="compact"
                      leading={<Download size={14} />}
                      label={t('chat.message.code.export')}
                      onActivate={() => handleExportCodeBlock(block.code, block.language)}
                    />
                    <Button
                      actionId="code-block-run"
                      emphasis="quiet"
                      density="compact"
                      leading={<Play size={14} />}
                      label={t('chat.message.code.run')}
                      onActivate={() => handleRunCodeBlock(block.code, block.language)}
                    />
                  </span>
                )}
              />
            </div>
          ) : null}

          {isTurnTail && <TurnAttribution projection={message.turnAttribution} />}

          {/* Inline translation */}
          {message.translation && (
            <div className="sc-assistant-message__translation">
              <div className="sc-assistant-message__translation-label">
                {t('chat.message.translation.label')}
              </div>
              <Markdown
                content={message.translation}
                style={{ fontSize: 14 }}
              />
            </div>
          )}

          {/* Error block. A user-cancelled turn is expressed once by the
              stopped banner, not as a failure strip. */}
          {message.error
            && !message.budgetNotice
            && message.typedError?.error_type !== 'LIFECYCLE_CANCELLED' && (
            <div
              className="sc-error-block selectable"
              data-pt-agent-error-conversation-id={
                message.resolution?.type === 'editQueue'
                  ? message.resolution.conversationId
                  : undefined
              }
              data-pt-agent-error-queue-capacity={
                message.resolution?.type === 'editQueue'
                  ? message.resolution.capacity
                  : undefined
              }
            >
              <AlertTriangle size={14} className="sc-error-block__icon" />
              <div className="sc-error-block__body">
                <div data-pt-agent-message-error-text={message.error}>{presentedError}</div>
                {isContextOverflow && (
                  <Button
                    actionId="assistant-reduce-context"
                    data-pt-agent-message-error-recovery="reduce-context"
                    tone="danger"
                    emphasis="primary"
                    density="compact"
                    className="sc-error-block__action"
                    leading={<Minimize2 size={14} />}
                    label={t('agent.recovery.reduceContext', { ns: 'agent' })}
                    onActivate={requestComposerFocus}
                  />
                )}
                {message.resolution && (
                  <Button
                    actionId="assistant-error-recovery"
                    data-pt-agent-message-error-recovery={resolutionTarget}
                    tone={
                      message.resolution.type !== 'openOriginal'
                      && message.resolution.type !== 'openResult'
                      && message.resolution.type !== 'editQueue'
                      && message.resolution.type !== 'selectRuntime'
                      && message.resolution.type !== 'openPermissionSettings'
                      && message.resolution.type !== 'retryLater'
                      && message.resolution.type !== 'retry'
                      && message.resolution.type !== 'inspectBudget'
                      && message.resolution.type !== 'switchAccount'
                      && message.resolution.type !== 'chooseCompatibleModel'
                      && message.resolution.type !== 'chooseTool'
                      && message.resolution.type !== 'chooseResourceAgain'
                      && message.resolution.type !== 'reconcile'
                      && message.resolution.type !== 'recover'
                        ? 'danger'
                        : undefined
                    }
                    emphasis="primary"
                    density="compact"
                    className="sc-error-block__action"
                    leading={
                      message.resolution.type === 'openProviderSettings'
                      || message.resolution.type === 'chooseCompatibleModel'
                      || message.resolution.type === 'chooseTool'
                      || message.resolution.type === 'selectRuntime'
                      || message.resolution.type === 'openPermissionSettings'
                        ? <Settings size={14} />
                        : message.resolution.type === 'openOriginal'
                          ? <ExternalLink size={14} />
                          : message.resolution.type === 'openResult'
                            ? <Activity size={14} />
                          : message.resolution.type === 'editQueue'
                            ? <ListOrdered size={14} />
                            : message.resolution.type === 'switchAccount'
                              ? <LogOut size={14} />
                            : message.resolution.type === 'retryLater'
                              ? <RotateCcw size={14} />
                            : message.resolution.type === 'retry'
                              ? <RotateCcw size={14} />
                            : message.resolution.type === 'confirmReset'
                              ? <RotateCcw size={14} />
                            : message.resolution.type === 'inspectBudget'
                              ? <Activity size={14} />
                            : message.resolution.type === 'recover'
                              ? <RotateCcw size={14} />
                              : message.resolution.type === 'reconcile'
                                ? <RotateCcw size={14} />
                              : message.resolution.type === 'chooseResourceAgain'
                                ? <FileText size={14} />
                              : message.resolution.type === 'removeReference'
                                ? <X size={14} />
                                : undefined
                    }
                    label={resolutionLabel}
                    onActivate={async () => {
                      try {
                        if (message.resolution!.type === 'openProviderSettings') {
                          eventBus.publish(EVENT.NAVIGATION_REQUESTED, {
                            resource: 'settings',
                            id: 'providers',
                          });
                          notifySuccess(t('chat.message.resolution.settingsOpened'));
                          return;
                        }
                        if (message.resolution!.type === 'openOriginal') {
                          handleOpenOriginal(
                            message.resolution!.existingCommandId ?? '',
                          );
                          return;
                        }
                        if (message.resolution!.type === 'openResult') {
                          handleOpenResult();
                          return;
                        }
                        if (message.resolution!.type === 'editQueue') {
                          await handleEditQueue();
                          return;
                        }
                        if (message.resolution!.type === 'selectRuntime') {
                          handleChooseCompatibleModel();
                          return;
                        }
                        if (message.resolution!.type === 'confirmReset') {
                          handleConfirmRuntimeReset();
                          return;
                        }
                        if (message.resolution!.type === 'openPermissionSettings') {
                          handleOpenPermissionSettings();
                          return;
                        }
                        if (message.resolution!.type === 'retryLater') {
                          await handleRetry();
                          return;
                        }
                        if (message.resolution!.type === 'retry') {
                          await handleRetry();
                          return;
                        }
                        if (message.resolution!.type === 'inspectBudget') {
                          handleInspectBudget();
                          return;
                        }
                        if (message.resolution!.type === 'switchAccount') {
                          await identityRuntime.logout();
                          return;
                        }
                        if (message.resolution!.type === 'chooseCompatibleModel') {
                          handleChooseCompatibleModel();
                          return;
                        }
                        if (message.resolution!.type === 'chooseTool') {
                          if (!activeAgent) {
                            notifyError(t('chat.message.resolution.actionFailed'));
                            return;
                          }
                          setAgentSurface(activeAgent.name, 'profile');
                          eventBus.publish(EVENT.NAVIGATION_REQUESTED, { resource: 'sessions' });
                          return;
                        }
                        if (message.resolution!.type === 'recover') {
                          await handleRetry();
                          return;
                        }
                        if (message.resolution!.type === 'reconcile') {
                          await handleReconcileClientLease();
                          return;
                        }
                        if (message.resolution!.type === 'chooseResourceAgain') {
                          requestComposerResourceSelection(
                            message.resolution!.resourceKind ?? '',
                            message.resolution!.resourceRefHash ?? '',
                          );
                          return;
                        }
                        if (message.resolution!.type === 'removeReference') {
                          requestComposerReferenceRemoval(
                            message.resolution!.referenceKind ?? '',
                            message.resolution!.referenceHash ?? '',
                          );
                          return;
                        }
                        const result = await api.resolveErrorAction(message.resolution!);
                        if (result.message) {
                          notifySuccess(result.message);
                        } else if (result.reauth) {
                          notifySuccess(t('chat.message.resolution.authOpened'));
                        } else if (result.opened) {
                          eventBus.publish(EVENT.NAVIGATION_REQUESTED, {
                            resource: 'settings',
                          });
                          notifySuccess(t('chat.message.resolution.settingsOpened'));
                        }
                      } catch (err: unknown) {
                        const errMessage = err instanceof Error ? err.message : String(err);
                        notifyError(errMessage || t('chat.message.resolution.actionFailed'));
                      }
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Audit row */}
        {(message.operation || message.replacementOf || message.replacedBy) && !message.loading && (
          <div className="sc-assistant-message__audit">
            {message.operation && (
              <span className="sc-tool-tag is-processing">
                {t(`chat.message.audit.${message.operation}`)}
              </span>
            )}
            {message.replacementOf && (
              <span className="sc-tool-tag">{t('chat.message.audit.replacement')}</span>
            )}
            {message.replacedBy && (
              <span className="sc-tool-tag">{t('chat.message.audit.replaced')}</span>
            )}
          </div>
        )}
      </div>

      {/* Destructive runtime reset confirmation (peer Dialog via FeedbackHost). */}
      <Dialog
        open={resetConfirmOpen}
        onDismiss={() => setResetConfirmOpen(false)}
        title={t('agent.recovery.confirmReset', { ns: 'agent' })}
        description={t('agent.recovery.confirmResetDescription', { ns: 'agent' })}
        closeLabel={t('chat.message.action.cancel', { ns: 'chat' })}
        width={440}
        footer={
          <div className="sc-reset-confirm__footer">
            <Button
              actionId="runtime-reset-cancel"
              emphasis="secondary"
              density="compact"
              label={t('chat.message.action.cancel', { ns: 'chat' })}
              onActivate={() => setResetConfirmOpen(false)}
            />
            <Button
              actionId="runtime-reset-confirm"
              data-pt-agent-runtime-reset-confirm={currentSessionKey}
              tone="danger"
              emphasis="primary"
              density="compact"
              label={t('agent.recovery.confirmReset', { ns: 'agent' })}
              onActivate={() => {
                setResetConfirmOpen(false);
                void performRuntimeReset();
              }}
            />
          </div>
        }
      />

      {/* Action bar */}
      {!message.loading && (
        <MessageActionBar
          context={{
            message,
            isStreaming: !!message.loading,
            isCurrentSession: true,
            operation,
            onCopy: handleCopy,
            onEdit: () => { /* Assistant messages do not support inline edit */ },
            onDelete: handleDelete,
            onRegenerate: handleRegenerate,
            onRetry: handleRetry,
            onRetryRecovery: handleRetryRecovery,
            onReloadSnapshot: handleReloadSnapshot,
            onBranch: handleBranch,
            onContinue: () => continueGeneration(message.id),
            onDeleteAndRegenerate: handleDelAndRegenerate,
            onTranslate: () => translateMessage(message.id),
            onThread: () => openThread(currentSessionKey, message.id),
            onExport: () => {
              if (message.content) {
                const exported = `# Assistant Response\n\n${message.content}`;
                void navigator.clipboard.writeText(exported);
              }
            },
            onForward: () => setForwardOpen(true),
          }}
          style={{
            alignSelf: 'flex-start',
            opacity: hovered ? 1 : 0,
            pointerEvents: hovered ? 'auto' : 'none',
            transition: 'opacity 0.2s',
          }}
        />
      )}
      <ForwardMessageModal
        open={forwardOpen}
        messages={[message]}
        onClose={() => setForwardOpen(false)}
      />
    </div>
  );
}
