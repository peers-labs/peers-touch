import { createDesktopStore } from './createDesktopStore';
import { EVENT, eventBus } from '../kernel/events';
import { log } from '../utils/logger';
import i18n, { resolveI18nValue } from '../i18n/index';
import {
  api,
  type AgentConversation,
  type Session,
  type StreamEvent,
  type AgentAttachmentRefInput,
  type AgentErrorResolutionAction,
  type AgentRuntimeBudgetKind,
  type AgentTypedErrorPayload,
  type AgentTurnStreamError,
  type AgentTurnQueueListOutput,
  type AgentRuntimeBudgetInput,
  classifyAgentTurnTerminalEvent,
  isAgentLifecycleStaleVersionError,
  isAgentLifecycleTerminalMutationError,
  normalizeAgentTurnStreamError,
  resolveAgentTypedErrorAction,
} from '../services/desktop_api';
import { agentService } from '../services/agent-service';
import { useAgentStore } from './agent';
import { useAgentCapabilityStore } from './agentCapabilities';
import { useAgentTopicStore } from './agentTopics';
import {
  agentTurnRecoveryPhaseForEvent,
  isAgentTurnRecoveryPhaseTransitionAllowed,
  type AgentTurnRecoveryPhase,
} from './agentTurnRecovery';
import { currentAuthenticatedActorPtid } from './session';
import {
  conversationIdFromAgentDraftKey,
  createAgentDraftKey,
  isAgentDraftKey,
} from './agentDraft';
import { getDesktopAgentChatCache } from '../storage/desktopAgentChatCache';
import { toolRuntime } from '../runtimes/toolRuntime';
import type { CachedAgentConversation, CachedAgentMessage } from '@peers-touch/client-chat-core';
import type { AgentTurnSnapshotReloadResult } from '../runtimes/chatRuntime';
import type { ToolExecutionOwner } from '../gen/proto/domain/agent/agent_pb';
import {
  reduceStreamEvent,
  projectAgentTypedError,
  createOperation,
  completeOperation,
  failOperation,
  cancelOperation,
  isActiveOperation,
  type Operation,
  type TurnStreamEvent,
} from './streaming';

export { useAgentStore } from './agent';
export type { Session } from '../services/desktop_api';

export type ToolCallStatus = 'queued' | 'approval_required' | 'approved' | 'denied' | 'pending' | 'success' | 'error' | 'cancelled' | 'expired' | 'unknown_side_effect';
export type DelegationTaskStatus = 'completed' | 'failed' | 'timeout' | 'unknown';

export interface DelegationTaskInfo {
  taskId: string;
  parentTurnId?: string;
  taskDescription: string;
  childToolset: string[];
  status: DelegationTaskStatus;
  resultSummary: string;
  toolIterations: number;
  startedAt?: string;
  endedAt?: string;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: string;
  result?: string;
  pending?: boolean;
  status?: ToolCallStatus;
  progress?: string;
  progressPct?: number;
  approvalId?: string;
  serverName?: string;
  source?: string;
  approvalActor?: string;
  approvedAt?: string;
  decisionId?: string;
  decisionRevision?: number;
  payloadHash?: string;
  expiresAt?: string;
  executionOwner?: ToolExecutionOwner;
  approvalPolicy?: string;
  manifestId?: string;
  manifestVersion?: string;
  bindingId?: string;
  bindingRevision?: number;
  readinessSnapshotId?: string;
  targetDeviceId?: string;
  error?: string;
  delegationResults?: DelegationTaskInfo[];
}

export interface KnowledgeChunkInfo {
  chunkId: string;
  resourceId: string;
  resourceTitle: string;
  source: string;
  chunkIndex: number;
  score: number;
  contentPreview: string;
}

export type MessageArtifactKind = 'code' | 'document' | 'diagram' | 'structured';

export interface MessageArtifact {
  id: string;
  messageId: string;
  kind: MessageArtifactKind;
  title: string;
  language?: string;
  content: string;
  createdAt: number;
  sourceRange?: {
    start: number;
    end: number;
  };
}

export interface ChatComposerAttachment {
  cid: string;
  filename: string;
  mime_type: string;
  size: number;
  previewUrl?: string | null;
  url?: string;
  attachment?: AgentAttachmentRefInput;
}

export interface AgentSendLifecycle {
  onAccepted?: () => void;
  onRejected?: (error?: AgentTypedErrorPayload) => void;
  requestedBudget?: AgentRuntimeBudgetInput;
  clientIdempotencyKey?: string;
}

export interface ComposerReferenceRemovalIntent {
  sessionKey: string;
  referenceKind: string;
  referenceHash: string;
  nonce: number;
}

export interface ComposerResourceSelectionIntent {
  sessionKey: string;
  resourceKind: string;
  resourceRefHash: string;
  nonce: number;
}

export type BudgetExhaustionKind = AgentRuntimeBudgetKind;

export interface BudgetNotice {
  kind: BudgetExhaustionKind;
  turnId: string;
  limit?: string;
  localeKey: string;
}

export interface RecoveredTurnTerminal {
  status: 'completed' | 'cancelled' | 'failed' | 'interrupted';
  reason?: string;
  content?: string;
}

export type ErrorResolutionAction = AgentErrorResolutionAction;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  contentType?: 'text' | 'card';
  images?: string[];
  attachments?: ChatComposerAttachment[];
  toolName?: string;
  toolCallId?: string;
  toolCalls?: ToolCallInfo[];
  delegationResults?: DelegationTaskInfo[];
  knowledgeChunks?: KnowledgeChunkInfo[];
  loading?: boolean;
  timestamp: number;
  model?: string;
  error?: string;
  cancelled?: boolean;
  terminalStatus?: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  typedError?: AgentTypedErrorPayload;
  errorDetail?: string;
  resolution?: ErrorResolutionAction | null;
  providerId?: string;
  thinking?: string;
  thinkingDone?: boolean;
  processDuration?: number;
  followUpSuggestions?: string[];
  translation?: string;
  lastEventAt?: number;
  operation?: 'regenerate' | 'retry' | 'branch';
  replacementOf?: string;
  replacedBy?: string;
  turnId?: string;
  queued?: boolean;
  queueEntryId?: string;
  queuePosition?: number;
  budgetNotice?: BudgetNotice;
}

// #region debug-point A-B:foundation-approval-receiver
function reportFoundationApprovalReceiverDebug(
  stage: string,
  messages: readonly ChatMessage[],
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7782/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-approval-receiver',
      runId: 'post-fix',
      hypothesisId: 'A-B',
      location: 'chat.ts:syncMessages',
      msg: `[DEBUG] ${stage}`,
      data: {
        messageCount: messages.length,
        toolCallCount: messages.reduce(
          (count, message) => count + (message.toolCalls?.length ?? 0),
          0,
        ),
        pendingToolCallCount: messages.reduce(
          (count, message) => count + (
            message.toolCalls?.filter((toolCall) => toolCall.pending).length
            ?? 0
          ),
          0,
        ),
      },
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

// #region debug-point A-E:approval-expiry-retry
function reportApprovalExpiryRetryDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7777/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'approval-expiry-retry',
      runId: 'post-fix',
      hypothesisId,
      location: 'chat.ts:retryMessage',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

// #region debug-point N-Q:foundation-attachment-receiver
function reportFoundationAttachmentReceiverDebug(
  hypothesisId: string,
  stage: string,
  data: Record<string, unknown>,
): void {
  if (import.meta.env.VITE_ACCEPTANCE_HARNESS !== '1') return;
  void fetch('http://127.0.0.1:7787/event', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: 'foundation-attachment-timeout',
      runId: 'post-fix',
      hypothesisId,
      location: 'chat.ts:sendMessage',
      msg: `[DEBUG] ${stage}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}
// #endregion

const agentChatCache = getDesktopAgentChatCache();

function cachedConversationToSession(conversation: CachedAgentConversation): Session {
  return {
    id: conversation.conversationId,
    key: conversation.conversationId,
    agent_name: conversation.agentId,
    title: resolveI18nValue(conversation.title) || '',
    message_count: 0,
    version: conversation.version,
    model_override: conversation.modelName,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  };
}

export function cachedMessageToChatMessage(message: CachedAgentMessage): ChatMessage {
  const persistedStatus = String(message.status || '').toLowerCase();
  const terminalStatus = (
    ['completed', 'failed', 'cancelled', 'interrupted'] as const
  ).find((status) => status === persistedStatus);
  let typedError: AgentTypedErrorPayload | undefined;
  if (message.errorJson) {
    try {
      const parsed = JSON.parse(message.errorJson);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        typedError = projectAgentTypedError(parsed as Record<string, unknown>);
      }
    } catch {
      typedError = undefined;
    }
  }
  const resolution = resolveAgentTypedErrorAction(typedError);
  const chatMessage: ChatMessage = {
    id: message.messageId,
    role: message.role,
    content: message.content,
    contentType: 'text',
    loading: message.role === 'assistant' && persistedStatus === 'pending',
    timestamp: new Date(message.createdAt).getTime(),
    model: message.modelName,
    turnId: message.turnId,
    error: typedError?.locale_key,
    typedError,
    resolution,
    providerId: typedError?.details.provider_id,
    attachments: message.attachments?.map((attachment) => ({
      cid: attachment.objectRef,
      filename: attachment.filename,
      mime_type: attachment.mimeType,
      size: attachment.sizeBytes,
      attachment: {
        attachment_id: attachment.attachmentId,
        object_ref: attachment.objectRef,
        mime_type: attachment.mimeType,
        size_bytes: attachment.sizeBytes,
        checksum: attachment.checksum,
        filename: attachment.filename,
        authorization_scope: attachment.authorizationScope,
        expires_at: attachment.expiresAt,
        extracted_content_ref: attachment.extractedContentRef,
      },
    })),
  };
  if (message.role === 'assistant' && terminalStatus) {
    chatMessage.loading = false;
    chatMessage.terminalStatus = terminalStatus;
    chatMessage.cancelled = terminalStatus === 'cancelled';
  }
  if (message.role === 'assistant' && message.reasoningJson) {
    try {
      const reasoning = JSON.parse(message.reasoningJson) as { text?: string; done?: boolean; duration_ms?: number };
      chatMessage.thinking = reasoning.text;
      chatMessage.thinkingDone = reasoning.done ?? true;
      if (typeof reasoning.duration_ms === 'number') chatMessage.processDuration = reasoning.duration_ms;
    } catch {
      chatMessage.thinking = message.reasoningJson;
      chatMessage.thinkingDone = true;
    }
  }
  if (message.role === 'assistant' && message.toolCallsJson) {
    try {
      const parsed = JSON.parse(message.toolCallsJson) as Array<{
        id?: string;
        name?: string;
        args?: string;
        result?: string;
        status?: ToolCallStatus;
        approval_id?: string;
        decision_id?: string;
        decision_revision?: number;
        payload_hash?: string;
        expires_at?: string;
        execution_owner?: ToolExecutionOwner;
        approval_policy?: string;
        manifest_id?: string;
        manifest_version?: string;
        binding_id?: string;
        binding_revision?: number;
        readiness_snapshot_id?: string;
        target_device_id?: string;
        server_name?: string;
        source?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      chatMessage.toolCalls = parsed.map((toolCall) => ({
        id: toolCall.id || toolCall.name || '',
        name: toolCall.name || toolCall.function?.name || 'tool',
        args: toolCall.args ?? toolCall.function?.arguments,
        result: toolCall.result,
        pending: toolCall.status === 'approval_required' ||
          toolCall.status === 'approved' ||
          toolCall.status === 'pending',
        status: toolCall.status,
        approvalId: toolCall.approval_id,
        decisionId: toolCall.decision_id,
        decisionRevision: toolCall.decision_revision,
        payloadHash: toolCall.payload_hash,
        expiresAt: toolCall.expires_at,
        executionOwner: toolCall.execution_owner,
        approvalPolicy: toolCall.approval_policy,
        manifestId: toolCall.manifest_id,
        manifestVersion: toolCall.manifest_version,
        bindingId: toolCall.binding_id,
        bindingRevision: toolCall.binding_revision,
        readinessSnapshotId: toolCall.readiness_snapshot_id,
        targetDeviceId: toolCall.target_device_id,
        serverName: toolCall.server_name,
        source: toolCall.source,
      }));
    } catch {
      // Malformed persisted tool-call payload; render message without tool calls.
    }
  }
  // Restore a persisted translation from message metadata (R10).
  if (message.metadataJson) {
    try {
      const meta = JSON.parse(message.metadataJson) as { translation?: string };
      if (meta.translation) chatMessage.translation = meta.translation;
    } catch {
      // Malformed metadata; ignore.
    }
  }
  return chatMessage;
}

function foldToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const folded: ChatMessage[] = [];
  for (const message of messages) {
    if (message.role === 'tool' && folded.length > 0) {
      const previous = folded[folded.length - 1];
      if (previous.role === 'assistant') {
        const nameMatch = message.content.match(/\*\*(\w+)\*\*/);
        const existing = previous.toolCalls || [];
        previous.toolCalls = [...existing, {
          id: message.id,
          name: nameMatch?.[1] || 'tool',
          result: message.content,
          pending: false,
        }];
        continue;
      }
    }
    folded.push(message);
  }
  return folded;
}

function reconcileToolMessages(messages: ChatMessage[]): ChatMessage[] {
  const folded = foldToolMessages(messages);
  void toolRuntime.reconcileMessages(folded).catch((error) => {
    log.warn('chat', 'Failed to reconcile ToolCall projections', {
      error: String(error),
    });
  });
  return folded;
}

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith('temp-');
}

function isInFlightMessage(message: ChatMessage): boolean {
  return message.loading === true || Boolean(message.error) || Boolean(message.terminalStatus);
}

function carryChainOfThoughtFields(target: ChatMessage, source: ChatMessage): ChatMessage {
  const sourceOwnsNonTerminalLeaseIncident =
    source.loading === true
    && source.terminalStatus === undefined
    && source.typedError?.error_type === 'CLIENT_LEASE_EXPIRED'
    && source.typedError?.terminal === false;
  const targetOwnsTerminal =
    Boolean(target.terminalStatus) && !sourceOwnsNonTerminalLeaseIncident;
  const terminalStatusMatches = targetOwnsTerminal
    && target.terminalStatus === source.terminalStatus;
  const hasCot = source.toolCalls
    || source.thinking
    || source.thinkingDone != null
    || source.processDuration != null
    || source.lastEventAt != null
    || source.attachments?.length
    || source.images?.length
    || source.operation
    || source.replacementOf
    || source.replacedBy
    || source.typedError
    || source.errorDetail
    || source.resolution
    || source.budgetNotice;
  const merged = hasCot ? {
    ...target,
    toolCalls: target.toolCalls ?? source.toolCalls,
    thinking: target.thinking ?? source.thinking,
    thinkingDone: target.thinkingDone ?? source.thinkingDone,
    processDuration: target.processDuration ?? source.processDuration,
    lastEventAt: target.lastEventAt ?? source.lastEventAt,
    attachments: target.attachments ?? source.attachments,
    images: target.images ?? source.images,
    operation: target.operation ?? source.operation,
    replacementOf: target.replacementOf ?? source.replacementOf,
    replacedBy: target.replacedBy ?? source.replacedBy,
    error: targetOwnsTerminal ? target.error : target.error ?? source.error,
    typedError:
      targetOwnsTerminal ? target.typedError : target.typedError ?? source.typedError,
    errorDetail:
      targetOwnsTerminal
        ? target.errorDetail ?? (
          terminalStatusMatches ? source.errorDetail : undefined
        )
        : target.errorDetail ?? source.errorDetail,
    resolution:
      targetOwnsTerminal ? target.resolution : target.resolution ?? source.resolution,
    budgetNotice: target.budgetNotice ?? source.budgetNotice,
  } : target;
  if (sourceOwnsNonTerminalLeaseIncident) {
    return {
      ...merged,
      error: source.error,
      typedError: source.typedError,
      errorDetail: source.errorDetail,
      resolution: source.resolution,
      loading: true,
      cancelled: false,
      terminalStatus: undefined,
    };
  }
  if (!source.terminalStatus || targetOwnsTerminal) return merged;
  return {
    ...merged,
    loading: false,
    cancelled: source.terminalStatus === 'cancelled' || source.cancelled === true,
    terminalStatus: source.terminalStatus,
    error: merged.error ?? source.error,
    errorDetail: merged.errorDetail ?? source.errorDetail,
  };
}

export function mergeServerMessages(currentMessages: ChatMessage[], serverMessages: ChatMessage[]): ChatMessage[] {
  const currentById = new Map<string, ChatMessage>();
  const currentAssistantByTurnId = new Map<string, ChatMessage>();
  for (const message of currentMessages) currentById.set(message.id, message);
  for (const message of currentMessages) {
    if (message.role === 'assistant' && message.turnId) {
      currentAssistantByTurnId.set(message.turnId, message);
    }
  }

  const merged: ChatMessage[] = serverMessages.map((serverMessage) => {
    const match = currentById.get(serverMessage.id)
      ?? (
        serverMessage.role === 'assistant' && serverMessage.turnId
          ? currentAssistantByTurnId.get(serverMessage.turnId)
          : undefined
      );
    if (!match) return serverMessage;
    return carryChainOfThoughtFields(serverMessage, match);
  });

  for (const currentMessage of currentMessages) {
    if (
      currentMessage.role !== 'assistant'
      || !currentMessage.turnId
      || !currentMessage.toolCalls?.length
      || (!isOptimisticMessageId(currentMessage.id)
        && !isInFlightMessage(currentMessage))
      || merged.some(
        (message) =>
          message.role === 'assistant'
          && message.turnId === currentMessage.turnId,
      )
    ) {
      continue;
    }
    const unkeyedAssistantIndex = merged.findIndex(
      (message) =>
        message.role === 'assistant'
        && !message.turnId
        && message.timestamp >= currentMessage.timestamp - 1000,
    );
    if (unkeyedAssistantIndex === -1) continue;
    merged[unkeyedAssistantIndex] = carryChainOfThoughtFields(
      {
        ...merged[unkeyedAssistantIndex],
        turnId: currentMessage.turnId,
      },
      currentMessage,
    );
  }

  const mergedIds = new Set(merged.map((message) => message.id));
  const mergedAssistantTurnIds = new Set(
    merged
      .filter((message) => message.role === 'assistant' && message.turnId)
      .map((message) => message.turnId as string),
  );

  for (const message of currentMessages) {
    if (mergedIds.has(message.id)) continue;
    if (
      message.role === 'assistant'
      && message.turnId
      && mergedAssistantTurnIds.has(message.turnId)
    ) {
      continue;
    }
    const isLocalOnly = isOptimisticMessageId(message.id) || isInFlightMessage(message);
    if (!isLocalOnly) continue;
    if (isSupersededByServer(message, serverMessages, currentMessages)) continue;
    merged.push(message);
  }

  return merged;
}

function isSupersededByServer(
  localMessage: ChatMessage,
  serverMessages: ChatMessage[],
  currentMessages: ChatMessage[],
): boolean {
  if (localMessage.role === 'user') {
    return serverMessages.some(
      (serverMessage) => serverMessage.role === 'user'
        && serverMessage.content === localMessage.content
        && serverMessage.timestamp >= localMessage.timestamp - 1000,
    );
  }
  if (localMessage.role === 'assistant') {
    if (
      localMessage.error
      || localMessage.typedError
      || localMessage.terminalStatus
    ) {
      return false;
    }
    const localIndex = currentMessages.indexOf(localMessage);
    const pairedUser = localIndex > 0 ? currentMessages[localIndex - 1] : undefined;
    if (pairedUser?.role === 'user' && isOptimisticMessageId(pairedUser.id)) {
      const serverUserIndex = serverMessages.findIndex(
        (serverMessage) => serverMessage.role === 'user'
          && serverMessage.content === pairedUser.content
          && serverMessage.timestamp >= pairedUser.timestamp - 1000,
      );
      if (serverUserIndex === -1) return false;
      return serverMessages.slice(serverUserIndex + 1).some(
        (serverMessage) => serverMessage.role === 'assistant'
          && !serverMessage.loading
          && Boolean(serverMessage.content),
      );
    }
    const serverHasCompletedReply = serverMessages.some(
      (serverMessage) => serverMessage.role === 'assistant'
        && !serverMessage.loading
        && Boolean(serverMessage.content)
        && serverMessage.timestamp >= localMessage.timestamp - 1000,
    );
    if (serverHasCompletedReply && (localMessage.loading || !localMessage.content)) return true;
  }
  return false;
}

function normalizeDelegationStatus(value: unknown): DelegationTaskStatus {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'delegation_status_completed') return 'completed';
  if (normalized === 'failed' || normalized === 'delegation_status_failed') return 'failed';
  if (normalized === 'timeout' || normalized === 'delegation_status_timeout') return 'timeout';
  return 'unknown';
}

function stringArrayField(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

export function parseDelegationResults(value: string): DelegationTaskInfo[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      taskId: String(item.TaskID || item.taskId || ''),
      parentTurnId: String(item.ParentTurnID || item.parentTurnId || ''),
      taskDescription: String(item.TaskDescription || item.taskDescription || item.Description || item.description || ''),
      childToolset: stringArrayField(item.ChildToolset || item.childToolset),
      status: normalizeDelegationStatus(item.Status || item.status),
      resultSummary: String(item.ResultSummary || item.resultSummary || ''),
      toolIterations: Number(item.ToolIterations ?? item.toolIterations ?? 0),
      startedAt: String(item.StartedAt || item.startedAt || ''),
      endedAt: String(item.EndedAt || item.endedAt || ''),
    })).filter((item) => item.taskId && item.taskDescription);
  } catch {
    return [];
  }
}

const FENCE_PATTERN = /```([^\n`]*)\n([\s\S]*?)```/g;
const DOCUMENT_HEADING_PATTERN = /(^|\n)#{1,3}\s+\S/;
const DOCUMENT_TABLE_PATTERN = /(^|\n)\|.+\|\n\|[-:\s|]+\|/;

function artifactKindForLanguage(language: string): MessageArtifactKind {
  const normalized = language.trim().toLowerCase();
  if (normalized === 'mermaid' || normalized === 'plantuml' || normalized === 'dot') return 'diagram';
  if (['json', 'yaml', 'yml', 'toml', 'xml', 'csv'].includes(normalized)) return 'structured';
  if (['markdown', 'md', 'mdx'].includes(normalized)) return 'document';
  return 'code';
}

function sanitizeArtifactLanguage(raw: string): string {
  return raw.trim().split(/\s+/)[0]?.toLowerCase() || 'text';
}

function looksLikeDocumentArtifact(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 600) return false;
  return DOCUMENT_HEADING_PATTERN.test(trimmed) || DOCUMENT_TABLE_PATTERN.test(trimmed);
}

export function extractMessageArtifacts(message: Pick<ChatMessage, 'id' | 'role' | 'content' | 'timestamp'>): MessageArtifact[] {
  if (message.role !== 'assistant') return [];
  const content = message.content.trim();
  if (!content) return [];

  const artifacts: MessageArtifact[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = FENCE_PATTERN.exec(message.content)) !== null) {
    const language = sanitizeArtifactLanguage(match[1] || 'text');
    const artifactContent = (match[2] || '').trim();
    if (!artifactContent) continue;
    const kind = artifactKindForLanguage(language);
    artifacts.push({
      id: `${message.id}:fence:${index}`,
      messageId: message.id,
      kind,
      title: `${kind}:${language}:${index + 1}`,
      language,
      content: artifactContent,
      createdAt: message.timestamp,
      sourceRange: {
        start: match.index,
        end: match.index + match[0].length,
      },
    });
    index += 1;
  }

  if (looksLikeDocumentArtifact(content)) {
    artifacts.unshift({
      id: `${message.id}:document`,
      messageId: message.id,
      kind: 'document',
      title: 'document:markdown:1',
      language: 'markdown',
      content,
      createdAt: message.timestamp,
    });
  }

  return artifacts;
}

export type ChatOperation = Operation;

export interface AgentRevisionCommandFailure {
  conversationId: string;
  resourceId: string;
  expectedRevision: number;
  actualRevision: number;
  typedError: AgentTypedErrorPayload;
  resolution: AgentErrorResolutionAction & {
    type: 'reloadLatest';
    resourceId: string;
    expectedRevision: number;
    actualRevision: number;
  };
}

interface ChatState {
  sessions: Session[];
  currentSessionKey: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingStartedAt: number | null;
  operations: Record<string, ChatOperation>;
  turnQueues: Record<string, AgentTurnQueueListOutput>;
  sessionBuffers: Record<string, ChatMessage[]>;
  abortController: AbortController | null;
  memoryDisabledSessions: Record<string, boolean>;
  draftPromotions: Record<string, string>;
  readinessErrorKey: string | null;
  revisionCommandFailure: AgentRevisionCommandFailure | null;
  revisionReloadingConversationId: string | null;


  wideScreen: boolean;

  // Composer fill channel (I2 follow-up): a one-shot request to populate the ChatInput
  // draft WITHOUT sending, aligning with LobeHub `fillInputMessage`. ChatInput consumes
  // the pending value, writes it into its draft, focuses, and clears the request.
  composerFill: { text: string; nonce: number } | null;
  composerReferenceRemoval: ComposerReferenceRemovalIntent | null;
  composerResourceSelection: ComposerResourceSelectionIntent | null;
  composerFocusNonce: number;

  loadSessions: () => Promise<void>;
  mergeSessions: (sessions: Session[]) => void;
  mergeSessionModel: (key: string, model: string, agentId: string) => void;
  selectSession: (key: string, sessionOverride?: Session) => Promise<void>;
  bootstrapSession: () => Promise<void>;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  sendMessage: (
    content: string,
    attachments?: ChatComposerAttachment[],
    lifecycle?: AgentSendLifecycle,
  ) => boolean;
  regenerateMessage: (messageId: string) => Promise<void>;
  retryMessage: (messageId: string) => Promise<void>;
  deleteAndRegenerateMessage: (messageId: string) => Promise<void>;
  branchFromMessage: (messageId: string) => Promise<void>;
  requestTurnCancellation: (
    turnId: string,
    assistantMessageId?: string,
  ) => Promise<void>;
  stopStreaming: () => void;
  stopOperation: (sessionKey: string) => void;
  continueGeneration: (messageId: string) => void;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  translateMessage: (id: string) => Promise<void>;
  reset: () => void;

  syncMessages: () => Promise<void>;
  applyRecoveredTurnEvent: (
    conversationId: string,
    agentId: string,
    turnId: string,
    event: StreamEvent,
  ) => void;
  reconcileRecoveredTurn: (
    conversationId: string,
    turnId: string,
    terminal: RecoveredTurnTerminal | null,
  ) => Promise<void>;
  retryTurnRecovery: (conversationId?: string) => void;
  reloadTurnSnapshot: (conversationId?: string) => Promise<AgentTurnSnapshotReloadResult>;
  reloadLatestRevision: (conversationId?: string) => Promise<void>;
  reconcileClientLease: (
    conversationId: string,
    messageId: string,
    sessionId: string,
    leaseId: string,
    turnId?: string,
  ) => Promise<void>;
  syncTurnQueue: (conversationId?: string) => Promise<void>;
  cancelQueuedTurn: (conversationId: string, queueEntryId: string) => Promise<void>;
  setWideScreen: (wide: boolean) => void;
  fillComposer: (text: string) => void;
  consumeComposerFill: () => void;
  requestComposerReferenceRemoval: (
    referenceKind: string,
    referenceHash: string,
  ) => void;
  consumeComposerReferenceRemoval: (nonce: number) => void;
  requestComposerResourceSelection: (
    resourceKind: string,
    resourceRefHash: string,
  ) => void;
  consumeComposerResourceSelection: (nonce: number) => void;
  requestComposerFocus: () => void;
  consumeComposerFocus: () => void;
  toggleSessionMemory: (sessionKey?: string) => void;
  isMemoryDisabled: (sessionKey?: string) => boolean;
  loadPreferences: () => Promise<void>;
}

let messageCounter = 0;
let composerReferenceRemovalCounter = 0;
let composerResourceSelectionCounter = 0;
const pendingMessageRetries = new Map<string, Promise<void>>();

function tempId() {
  return `temp-${Date.now()}-${messageCounter++}`;
}

async function stationConversationVersion(conversationId: string): Promise<number> {
  const conversation = await api.getAgentConversation(conversationId);
  return conversation.version;
}

async function revisionCommandVersion(
  conversationId: string,
  sessions: Session[],
): Promise<number> {
  const projectedVersion = sessions.find(
    (session) => session.key === conversationId,
  )?.version;
  if (
    typeof projectedVersion === 'number'
    && Number.isSafeInteger(projectedVersion)
    && projectedVersion > 0
  ) {
    return projectedVersion;
  }
  return stationConversationVersion(conversationId);
}

export function projectAgentRevisionCommandFailure(
  error: unknown,
  conversationId: string,
): AgentRevisionCommandFailure | null {
  const normalized = normalizeAgentTurnStreamError(error);
  const typedError = normalized.typedError;
  const resolution = normalized.resolution;
  if (
    !isAgentLifecycleStaleVersionError(typedError)
    || resolution?.type !== 'reloadLatest'
    || resolution.resourceId !== conversationId
    || resolution.expectedRevision === undefined
    || resolution.actualRevision === undefined
  ) {
    return null;
  }
  return {
    conversationId,
    resourceId: typedError.details.resource_id,
    expectedRevision: resolution.expectedRevision,
    actualRevision: resolution.actualRevision,
    typedError,
    resolution: resolution as AgentRevisionCommandFailure['resolution'],
  };
}

export function projectAgentTerminalMutationMessage(
  message: ChatMessage,
  error: AgentTurnStreamError,
  turnId: string,
  assistantMessageId?: string,
): ChatMessage {
  const typedError = error.typedError;
  const resolution = error.resolution;
  const matchesMessage = (
    message.role === 'assistant'
    && (
      (assistantMessageId !== undefined && message.id === assistantMessageId)
      || message.turnId === turnId
    )
  );
  if (
    !matchesMessage
    || !isAgentLifecycleTerminalMutationError(typedError)
    || resolution?.type !== 'openResult'
    || resolution.resourceId !== turnId
    || resolution.turnId !== turnId
    || resolution.terminalStatus !== typedError.details.terminal_status
  ) {
    return message;
  }
  return {
    ...message,
    error: typedError.locale_key,
    typedError,
    errorDetail: error.errorDetail || message.errorDetail,
    resolution,
    loading: false,
    terminalStatus: resolution.terminalStatus,
    cancelled: resolution.terminalStatus === 'cancelled',
  };
}

function reconcileRevisionSession(
  sessions: Session[],
  conversation: AgentConversation,
): Session[] {
  const existing = sessions.find(
    (session) => session.key === conversation.conversation_id,
  );
  const reloaded: Session = {
    id: conversation.conversation_id,
    key: conversation.conversation_id,
    agent_name: conversation.agent_id,
    title: resolveI18nValue(conversation.title) || '',
    message_count: existing?.message_count ?? 0,
    version: conversation.version,
    model_override: conversation.model_name,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    pinned: existing?.pinned,
    favorite: existing?.favorite,
  };
  return existing
    ? sessions.map((session) => (
        session.key === conversation.conversation_id ? reloaded : session
      ))
    : [reloaded, ...sessions];
}

function presentChatRuntimeError(message: string): string {
  if (/unknown command|agent_execute_turn_stream|chat_completion_stream|Failed to execute agent turn/.test(message)) {
    return i18n.t("chat.runtime.unavailable", { ns: "chat", defaultValue: "The selected runtime is not ready. Check model credentials and try again." });
  }
  if (/no credentials|credential (not found|missing|invalid)|provider.*not found for actor|record not found/i.test(message)) {
    return i18n.t("chat.runtime.unavailable", { ns: "chat", defaultValue: "The selected runtime is not ready. Check model credentials and try again." });
  }
  return message;
}

export function applyStreamEvent(msg: ChatMessage, event: StreamEvent): ChatMessage {
  const reduced = reduceStreamEvent(msg, event as TurnStreamEvent);
  const toolCalls = toolRuntime.reduceToolCalls(reduced.toolCalls, event);
  return bindStreamEventTurnIdentity(
    mergeToolProjection(reduced, toolCalls),
    event,
  );
}

function applyProjectedStreamEvent(msg: ChatMessage, event: StreamEvent): ChatMessage {
  const reduced = reduceStreamEvent(msg, event as TurnStreamEvent);
  const toolCalls = toolRuntime.projectToolCalls(reduced.toolCalls, event);
  return bindStreamEventTurnIdentity(
    mergeToolProjection(reduced, toolCalls),
    event,
  );
}

export function clearReconciledClientLeaseError(
  message: ChatMessage,
  messageId: string,
  sessionId: string,
  leaseId: string,
  turnId?: string,
): ChatMessage {
  if (
    message.id !== messageId
    || (turnId && message.turnId !== turnId)
  ) {
    return message;
  }
  if (
    message.typedError
    && (
      message.typedError.error_type !== 'CLIENT_LEASE_EXPIRED'
      || message.typedError.details.session_id !== sessionId
      || message.typedError.details.lease_id !== leaseId
    )
  ) {
    return message;
  }
  return {
    ...message,
    error: undefined,
    typedError: undefined,
    errorDetail: undefined,
    resolution: undefined,
    loading: true,
    cancelled: false,
    terminalStatus: undefined,
  };
}

function bindStreamEventTurnIdentity(
  message: ChatMessage,
  event: StreamEvent,
): ChatMessage {
  const turnId = typeof event.data?.turnId === 'string'
    ? event.data.turnId
    : typeof event.data?.turn_id === 'string'
      ? event.data.turn_id
      : '';
  if (!turnId || message.turnId === turnId) return message;
  return { ...message, turnId };
}

function mergeToolProjection(
  reduced: ChatMessage,
  toolCalls: ToolCallInfo[] | undefined,
): ChatMessage {
  const delegationResults = toolCalls
    ?.flatMap((toolCall) => toolCall.delegationResults || []);
  return {
    ...reduced,
    toolCalls,
    delegationResults: delegationResults?.length
      ? delegationResults
      : reduced.delegationResults,
  };
}

function buildAgentTurnInput(
  conversationId: string,
  agentId: string,
  userInput: string,
  attachments: ChatComposerAttachment[],
  requestedBudget?: AgentRuntimeBudgetInput,
  clientIdempotencyKey?: string,
) {
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((a) => a.id === agentId);
  const clientCapabilitySessionId = useAgentCapabilityStore
    .getState()
    .readinessByAgentId[agentId]
    ?.selectedClientSessionId;
  return {
    client_idempotency_key: clientIdempotencyKey || tempId(),
    conversation_id: conversationId,
    agent_id: agentId,
    user_input: userInput,
    provider: agent?.provider || undefined,
    model: agent?.model || undefined,
    requested_budget: requestedBudget,
    client_capability_session_id: clientCapabilitySessionId,
    attachments: attachments
      .map((item) => item.attachment)
      .filter((item): item is AgentAttachmentRefInput => Boolean(item)),
  };
}

function resolveAgentExecutionID(agentName: string): string | null {
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((item) => item.name === agentName);
  return agent?.id || null;
}

function reconcileTopicsAfterTurn(sessionKey: string): void {
  const topicStore = useAgentTopicStore.getState();
  void topicStore.reconcileSelectedAgentTopics('turn-done').then(() => {
    const topic = topicStore
      .getTopicsForAgent(topicStore.activeAgentId)
      .find((item) => item.key === sessionKey);
    if (topic?.titleState === 'untitled') {
      void topicStore.smartRenameTopic(sessionKey).catch((error) => {
        log.warn('chat', 'Auto topic title generation failed', { sessionKey, error: String(error) });
      });
    }
  });
}

function streamEventConfirmsAdmission(event: StreamEvent): boolean {
  if (event.event === 'error') return false;
  const turnId = String(
    event.data?.turnId ?? event.data?.turn_id ?? '',
  ).trim();
  return Boolean(turnId)
    || event.event === 'conversation_created'
    || event.event === 'queued'
    || event.event === 'admission_replayed';
}

function clearOperation(operations: Record<string, ChatOperation>, sessionKey: string): Record<string, ChatOperation> {
  const op = operations[sessionKey];
  if (!op) return operations;
  if (
    op.runState === 'failed'
    || op.runState === 'cancelled'
    || op.runState === 'interrupted'
  ) {
    return operations;
  }
  return { ...operations, [sessionKey]: completeOperation(op) };
}

function settleRecoveredOperation(
  operation: ChatOperation,
  terminal: RecoveredTurnTerminal,
): ChatOperation {
  if (terminal.status === 'completed') return completeOperation(operation);
  if (terminal.status === 'cancelled') {
    return {
      ...cancelOperation(operation),
      error: terminal.reason ? { message: terminal.reason } : operation.error,
    };
  }
  if (terminal.status === 'interrupted') {
    return {
      ...operation,
      status: 'interrupted',
      runState: 'interrupted',
      error: {
        message: terminal.reason || operation.error?.message || 'agent.error.streamInterrupted',
      },
      endedAt: Date.now(),
    };
  }
  return failOperation(operation, {
    message: terminal.reason || operation.error?.message || 'agent.error.streamFailed',
  });
}

function failOperationInMap(operations: Record<string, ChatOperation>, sessionKey: string, error: string): Record<string, ChatOperation> {
  const op = operations[sessionKey];
  if (!op) return operations;
  return { ...operations, [sessionKey]: failOperation(op, { message: error }) };
}

function setBuffer(
  buffers: Record<string, ChatMessage[]>,
  sessionKey: string,
  updater: (messages: ChatMessage[]) => ChatMessage[],
): Record<string, ChatMessage[]> {
  const current = buffers[sessionKey] || [];
  return { ...buffers, [sessionKey]: updater(current) };
}

function clearBuffer(buffers: Record<string, ChatMessage[]>, sessionKey: string): Record<string, ChatMessage[]> {
  if (!buffers[sessionKey]) return buffers;
  const next = { ...buffers };
  delete next[sessionKey];
  return next;
}

export function shouldUseSessionBuffer(operation?: ChatOperation): boolean {
  return isActiveOperation(operation)
    || isPreAdmissionFailure(operation);
}

function isPreAdmissionFailure(
  operation?: ChatOperation,
): operation is ChatOperation {
  return operation?.status === 'failed' && !operation.turnId;
}

function discardPreAdmissionFailureMessages(
  messages: ChatMessage[],
  operation?: ChatOperation,
  targetMessageId?: string,
): ChatMessage[] {
  if (!isPreAdmissionFailure(operation)) return messages;
  const assistantIndex = messages.findIndex(
    (message) => message.id === operation.assistantMessageId,
  );
  if (assistantIndex < 0) return messages;
  const optimisticIds = new Set([operation.assistantMessageId]);
  const precedingMessage = messages[assistantIndex - 1];
  if (
    precedingMessage?.role === 'user'
    && isOptimisticMessageId(precedingMessage.id)
  ) {
    optimisticIds.add(precedingMessage.id);
  }
  if (targetMessageId && !optimisticIds.has(targetMessageId)) return messages;
  return messages.filter((message) => !optimisticIds.has(message.id));
}

function removeOperation(
  operations: Record<string, ChatOperation>,
  sessionKey: string,
): Record<string, ChatOperation> {
  if (!operations[sessionKey]) return operations;
  const next = { ...operations };
  delete next[sessionKey];
  return next;
}

function operationRecoveryPhase(
  operation: ChatOperation,
): AgentTurnRecoveryPhase | undefined {
  switch (operation.runState) {
    case 'streaming':
      return 'CONNECTED';
    case 'connection_lost':
      return 'CONNECTION_LOST';
    case 'reconnecting':
      return 'RECONNECTING';
    case 'replaying':
      return 'REPLAYING';
    case 'reconciling':
      return 'RECONCILING';
    case 'recovery_failed':
      return 'RECOVERY_FAILED';
    default:
      return undefined;
  }
}

export function applyOperationEventIdentity(
  operations: Record<string, ChatOperation>,
  sessionKey: string,
  event: StreamEvent,
): { operations: Record<string, ChatOperation>; accepted: boolean } {
  const operation = operations[sessionKey];
  if (!operation) return { operations, accepted: true };
  const seq = Number(event.data?.seq || 0);
  const streamGeneration = Number(event.data?.streamGeneration || 0);
  const currentGeneration = operation.streamGeneration ?? 0;
  const recoveryPhase = agentTurnRecoveryPhaseForEvent(event.event);
  const currentRecoveryPhase = operationRecoveryPhase(operation);
  const sameSequenceRecoveryAdvance =
    recoveryPhase !== undefined
    && currentRecoveryPhase !== undefined
    && seq === (operation.lastEventSeq || 0)
    && isAgentTurnRecoveryPhaseTransitionAllowed(
      currentRecoveryPhase,
      recoveryPhase,
    );
  if (
    streamGeneration > 0
    && currentGeneration > 0
    && streamGeneration < currentGeneration
  ) {
    return { operations, accepted: false };
  }
  if (
    seq > 0
    && (operation.lastEventSeq || 0) >= seq
    && streamGeneration === currentGeneration
    && !sameSequenceRecoveryAdvance
    && !(
      event.event === 'snapshot'
      && (operation.lastEventSeq || 0) === seq
    )
  ) {
    return { operations, accepted: false };
  }
  const turnId =
    typeof event.data?.turnId === 'string'
      ? event.data.turnId
      : typeof event.data?.turn_id === 'string'
        ? event.data.turn_id
        : operation.turnId;
  const conversationId =
    typeof event.data?.conversationId === 'string'
      ? event.data.conversationId
      : typeof event.data?.conversation_id === 'string'
        ? event.data.conversation_id
        : operation.conversationId;
  if (
    operation.turnId
    && turnId
    && operation.turnId !== turnId
    && streamGeneration <= currentGeneration
  ) {
    return { operations, accepted: false };
  }
  const snapshotStatus = event.event === 'snapshot'
    ? String(event.data?.status || '').toLowerCase()
    : '';
  const terminalStatus = classifyAgentTurnTerminalEvent(event);
  const terminalRunState =
    terminalStatus === 'queued' ? null : terminalStatus;
  const runState = ({
    connection_lost: 'connection_lost',
    reconnecting: 'reconnecting',
    replaying: 'replaying',
    reconciling: 'reconciling',
    connected: 'streaming',
    recovery_failed: 'recovery_failed',
  } as const)[event.event]
    ?? terminalRunState
    ?? ({
      completed: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
      interrupted: 'interrupted',
    } as const)[snapshotStatus]
    ?? operation.runState;
  const status = runState === 'completed'
    ? 'completed'
    : runState === 'failed'
      ? 'failed'
      : runState === 'interrupted'
        ? 'interrupted'
      : runState === 'cancelled'
        ? 'cancelled'
        : operation.status;
  return {
    accepted: true,
    operations: {
      ...operations,
      [sessionKey]: {
        ...operation,
        turnId,
        conversationId,
        streamGeneration:
          streamGeneration > 0 ? streamGeneration : operation.streamGeneration,
        lastEventSeq: seq > 0 ? seq : operation.lastEventSeq,
        runState,
        status,
        endedAt:
          status === 'completed'
          || status === 'failed'
          || status === 'cancelled'
          || status === 'interrupted'
            ? operation.endedAt ?? Date.now()
            : operation.endedAt,
        error:
          status === 'failed' || status === 'interrupted'
            ? {
                message: String(
                  event.data?.terminal_reason
                  || event.data?.error
                  || operation.error?.message
                  || 'agent.error.streamFailed',
                ),
              }
            : operation.error,
      },
    },
  };
}

export function isMessageRetryBlocked(
  isStreaming: boolean,
  operation: ChatOperation | undefined,
  sourceTurnId: string | undefined,
  sourceTerminalStatus?: ChatMessage['terminalStatus'],
): boolean {
  if (!isStreaming) return false;
  const matchesActiveTurn = Boolean(
    sourceTurnId && operation?.turnId === sourceTurnId,
  );
  const sourceIsRetryableTerminal =
    sourceTerminalStatus === 'failed'
    || sourceTerminalStatus === 'cancelled'
    || sourceTerminalStatus === 'interrupted';
  const matchesTerminalOperation =
    matchesActiveTurn
    && sourceIsRetryableTerminal
    && operation?.runState === sourceTerminalStatus;
  if (matchesTerminalOperation) return false;
  if (
    matchesActiveTurn
    && sourceTerminalStatus === 'interrupted'
    && operation?.runState === 'replaying'
  ) {
    return false;
  }
  return (
    operation?.runState !== 'recovery_failed'
    || !matchesActiveTurn
  );
}

async function loadSessionMessages(
  key: string,
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
): Promise<void> {
  try {
    const cached = await agentChatCache.getMessages(key);
    if (get().currentSessionKey !== key) return;
    const cachedMessages = reconcileToolMessages(
      cached.map(cachedMessageToChatMessage),
    );
    set({ messages: mergeServerMessages(get().messages, cachedMessages) });
    void agentChatCache
      .syncConversation(key)
      .then((synced) => {
        if (get().currentSessionKey !== key) return;
        const serverMessages = reconcileToolMessages(
          synced.map(cachedMessageToChatMessage),
        );
        set({ messages: mergeServerMessages(get().messages, serverMessages) });
      })
      .catch((syncError) => {
        log.warn('chat', 'Background conversation sync failed; keeping cache', { key, error: String(syncError) });
      });
  } catch (error) {
    log.error('chat', 'Failed to load messages from cache; preserving current view', { key, error: String(error) });
  }
}

export const useChatStore = createDesktopStore<ChatState>('chat', (set, get) => ({
  sessions: [],
  currentSessionKey: 'main',
  messages: [],
  isStreaming: false,
  streamingStartedAt: null,
  operations: {},
  turnQueues: {},
  sessionBuffers: {},
  abortController: null,
  memoryDisabledSessions: {},
  draftPromotions: {},
  readinessErrorKey: null,
  revisionCommandFailure: null,
  revisionReloadingConversationId: null,


  wideScreen: false,
  composerFill: null,
  composerReferenceRemoval: null,
  composerResourceSelection: null,
  composerFocusNonce: 0,

  reset: () => {
    for (const operation of Object.values(get().operations)) {
      if (!operation.abortController.signal.aborted) {
        operation.abortController.abort();
      }
    }
    set({
      sessions: [],
      currentSessionKey: 'main',
      messages: [],
      isStreaming: false,
      streamingStartedAt: null,
      operations: {},
      turnQueues: {},
      sessionBuffers: {},
      abortController: null,
      memoryDisabledSessions: {},
      draftPromotions: {},
      readinessErrorKey: null,
      revisionCommandFailure: null,
      revisionReloadingConversationId: null,
      composerFill: null,
      composerReferenceRemoval: null,
      composerResourceSelection: null,
      composerFocusNonce: 0,
    });
  },

  loadSessions: async () => {
    log.info('chat', 'Loading sessions');
    const agentId = useAgentStore.getState().selectedAgent;
    if (!agentId) {
      set({ sessions: [] });
      return;
    }
    try {
      const conversations = await agentChatCache.listConversations(agentId);
      const sessions = conversations.map(cachedConversationToSession);
      log.info('chat', 'Sessions loaded from cache', { count: sessions.length });
      set({ sessions });
      const { currentSessionKey, messages, operations } = get();
      if (
        !isAgentDraftKey(currentSessionKey) &&
        messages.length === 0 &&
        !operations[currentSessionKey] &&
        sessions.some((s) => s.key === currentSessionKey)
      ) {
        log.info('chat', 'Bootstrapping current session after sessions load', { key: currentSessionKey });
        await loadSessionMessages(currentSessionKey, get, set);
      }
    } catch (e) {
      log.error('chat', 'Failed to load sessions', e);
    }
  },

  mergeSessions: (sessions: Session[]) => {
    set((state) => {
      const byKey = new Map(state.sessions.map((s) => [s.key, s]));
      for (const s of sessions) {
        byKey.set(s.key, s);
      }
      return { sessions: Array.from(byKey.values()) };
    });
  },

  mergeSessionModel: (key: string, model: string, agentId: string) => {
    set((state) => {
      const byKey = new Map(state.sessions.map((s) => [s.key, s]));
      const existing = byKey.get(key);
      const updated: Session = existing
        ? { ...existing, model_override: model }
        : { id: key, key, agent_name: agentId, title: '', message_count: 0, model_override: model, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      byKey.set(key, updated);
      return { sessions: Array.from(byKey.values()) };
    });
  },

  selectSession: async (key: string, _sessionOverride?: Session) => {
    log.info('chat', 'Selecting session', { key });
    if (key === get().currentSessionKey) return;
    const liveOp = get().operations[key];
    // Adopt active streams and local pre-admission rejections. Rejections have
    // no Station message to reload, so their recovery surface remains local to
    // the conversation until the user retries, deletes, or resolves it.
    const liveBuffer = shouldUseSessionBuffer(liveOp)
      ? get().sessionBuffers[key]
      : undefined;
    set({
      currentSessionKey: key,
      messages: liveBuffer ?? [],
      isStreaming: isActiveOperation(liveOp),
      streamingStartedAt: liveOp?.startedAt ?? null,
      abortController: liveOp?.abortController ?? null,
      readinessErrorKey: null,
    });
    if (liveBuffer) return;
    if (isAgentDraftKey(key)) {
      set({ messages: [] });
      return;
    }
    await loadSessionMessages(key, get, set);
  },

  bootstrapSession: async () => {
    const key = get().currentSessionKey;
    log.info('chat', 'Bootstrapping current session history', { key });
    if (isAgentDraftKey(key)) {
      set({ messages: [] });
      return;
    }
    const liveOp = get().operations[key];
    if (isActiveOperation(liveOp)) return;
    await loadSessionMessages(key, get, set);
  },

  newSession: () => {
    const { selectedAgent, agents } = useAgentStore.getState();
    const agent = agents.find((item) => item.name === selectedAgent);
    if (!agent) {
      log.warn('chat', 'Cannot create Agent draft before Agent projection is ready');
      return;
    }
    const key = createAgentDraftKey(agent.id);
    const agentName = selectedAgent || 'assistant';
    const now = new Date().toISOString();
    const draftSession: Session = {
      id: key,
      key,
      agent_name: agentName,
      title: '',
      message_count: 0,
      created_at: now,
      updated_at: now,
    };
    log.info('chat', 'New draft session created', { key, agentName });
    set((state) => ({
      currentSessionKey: key,
      messages: [],
      readinessErrorKey: null,
      sessions: [draftSession, ...state.sessions.filter((s) => !isAgentDraftKey(s.key))],
    }));
  },

  deleteSession: async (key: string) => {
    log.info('chat', 'Deleting session', { key });
    try {
      const version = await stationConversationVersion(key);
      await api.archiveAgentConversation(key, version, true);
      const { sessions, currentSessionKey } = get();
      const remaining = sessions.filter((s) => s.key !== key);
      if (key === currentSessionKey) {
        set({
          sessions: remaining,
          currentSessionKey: remaining[0]?.key || 'main',
          messages: [],
        });
      } else {
        set({ sessions: remaining });
      }
    } catch (e) {
      log.error('chat', 'Failed to delete session', e);
    }
  },

  syncMessages: async () => {
    log.debug('chat', 'Syncing messages', { key: get().currentSessionKey });
    const { currentSessionKey } = get();
    reportFoundationApprovalReceiverDebug(
      'authoritative-sync-start',
      get().messages,
    );

    try {
      if (isAgentDraftKey(currentSessionKey)) {
        return;
      }
      const synced = await agentChatCache.refreshConversation(currentSessionKey);
      if (get().currentSessionKey !== currentSessionKey) return;
      const serverMessages = reconcileToolMessages(
        synced.map(cachedMessageToChatMessage),
      );

      const merged = mergeServerMessages(get().messages, serverMessages);
      set({ messages: merged });
      reportFoundationApprovalReceiverDebug(
        'authoritative-sync-complete',
        merged,
      );
    } catch (error) {
      log.warn('chat', 'Failed to sync messages; keeping current view', { error: String(error) });
    }
  },

  applyRecoveredTurnEvent: (conversationId, _agentId, turnId, event) => {
    set((state) => {
      const currentOperation = state.operations[conversationId];
      const assistantMessageId =
        currentOperation?.assistantMessageId || `recovered-${turnId}`;
      const operation = currentOperation ?? {
        ...createOperation({
          sessionKey: conversationId,
          type: 'sendMessage',
          assistantMessageId,
          abortController: new AbortController(),
        }),
        conversationId,
        turnId,
        streamGeneration: Number(event.data?.streamGeneration || 0) || undefined,
      };
      const operations = {
        ...state.operations,
        [conversationId]: operation,
      };
      const operationEvent = applyOperationEventIdentity(
        operations,
        conversationId,
        {
          ...event,
          data: {
            ...event.data,
            turnId,
            conversationId,
          },
        },
      );
      if (!operationEvent.accepted) return state;

      const applyTo = (messages: ChatMessage[]): ChatMessage[] => {
        const existingIndex = messages.findIndex(
          (message) => (
            message.role === 'assistant'
            && (
              message.id === assistantMessageId
              || message.turnId === turnId
            )
          ),
        );
        const existing: ChatMessage = existingIndex >= 0
          ? messages[existingIndex]
          : {
              id: assistantMessageId,
              role: 'assistant',
              content: '',
              loading: true,
              timestamp: operation.startedAt,
              turnId,
            };
        const projected = {
          ...applyProjectedStreamEvent(existing, event),
          turnId,
        };
        if (existingIndex < 0) return [...messages, projected];
        const next = [...messages];
        next[existingIndex] = projected;
        return next;
      };
      const isCurrent = state.currentSessionKey === conversationId;
      const buffered = applyTo(
        state.sessionBuffers[conversationId] || (isCurrent ? state.messages : []),
      );
      return {
        operations: operationEvent.operations,
        sessionBuffers: {
          ...state.sessionBuffers,
          [conversationId]: buffered,
        },
        messages: isCurrent ? applyTo(state.messages) : state.messages,
        isStreaming: isCurrent ? true : state.isStreaming,
        streamingStartedAt: isCurrent ? operation.startedAt : state.streamingStartedAt,
        abortController: isCurrent ? operation.abortController : state.abortController,
      };
    });
  },

  reconcileRecoveredTurn: async (conversationId, turnId, terminal) => {
    let synced = await agentChatCache.syncConversation(conversationId);
    if (terminal) {
      const assistant = [...synced]
        .reverse()
        .find((message) => message.role === 'assistant' && message.turnId === turnId);
      if (assistant) {
        await agentChatCache.upsertMessage({
          ...assistant,
          status: terminal.status,
          content: terminal.content ?? assistant.content,
          reconciliationSource: 'station-snapshot',
          updatedAt: new Date().toISOString(),
        });
        synced = await agentChatCache.getMessages(conversationId);
      }
    }
    const operation = get().operations[conversationId];
    if (operation?.turnId !== turnId) return;
    const serverMessages = reconcileToolMessages(
      synced.map(cachedMessageToChatMessage),
    );
    const reconcileMessages = (messages: ChatMessage[]) => {
      const merged = mergeServerMessages(messages, serverMessages);
      if (!terminal) return merged;
      return merged.map((message) => {
        if (message.role !== 'assistant' || message.turnId !== turnId) {
          return message;
        }
        return applyProjectedStreamEvent(message, {
          event: 'snapshot',
          data: {
            conversationId,
            turnId,
            status: terminal.status,
            terminal_reason: terminal.reason,
            ...(terminal.content !== undefined
              ? { text: terminal.content }
              : {}),
          },
        });
      });
    };
    set((state) => {
      const current = state.operations[conversationId];
      if (current?.turnId !== turnId) return state;
      const isCurrent = state.currentSessionKey === conversationId;
      const reconciledBuffer = reconcileMessages(
        state.sessionBuffers[conversationId] || [],
      );
      return {
        messages: isCurrent
          ? reconcileMessages(state.messages)
          : state.messages,
        operations: terminal
          ? {
              ...state.operations,
              [conversationId]: settleRecoveredOperation(current, terminal),
            }
          : state.operations,
        sessionBuffers: terminal
          ? clearBuffer(state.sessionBuffers, conversationId)
          : {
              ...state.sessionBuffers,
              [conversationId]: reconciledBuffer,
            },
        isStreaming: isCurrent && terminal ? false : state.isStreaming,
        streamingStartedAt: isCurrent && terminal ? null : state.streamingStartedAt,
        abortController: isCurrent && terminal ? null : state.abortController,
      };
    });
  },

  retryTurnRecovery: (conversationId) => {
    const key = conversationId || get().currentSessionKey;
    eventBus.publish(EVENT.AGENT_TURN_RECOVERY_RETRY_REQUESTED, {
      conversationId: key,
    });
  },

  reloadTurnSnapshot: async (conversationId) => {
    const key = conversationId || get().currentSessionKey;
    const { reloadAgentTurnSnapshot } = await import('../runtimes/chatRuntime');
    return reloadAgentTurnSnapshot(key);
  },

  reloadLatestRevision: async (conversationId) => {
    const key = conversationId || get().currentSessionKey;
    const incident = get().revisionCommandFailure;
    if (!incident || incident.conversationId !== key) return;
    set({ revisionReloadingConversationId: key });
    try {
      const [conversation, synced] = await Promise.all([
        api.getAgentConversation(key),
        agentChatCache.refreshConversation(key),
      ]);
      const serverMessages = reconcileToolMessages(
        synced.map(cachedMessageToChatMessage),
      );
      set((state) => {
        const currentIncident = state.revisionCommandFailure;
        const isSameIncident = (
          currentIncident?.conversationId === incident.conversationId
          && currentIncident.expectedRevision === incident.expectedRevision
          && currentIncident.actualRevision === incident.actualRevision
        );
        return {
          sessions: reconcileRevisionSession(state.sessions, conversation),
          messages: state.currentSessionKey === key
            ? serverMessages
            : state.messages,
          revisionCommandFailure: isSameIncident
            ? null
            : state.revisionCommandFailure,
          revisionReloadingConversationId:
            state.revisionReloadingConversationId === key
              ? null
              : state.revisionReloadingConversationId,
        };
      });
    } catch (error) {
      set((state) => ({
        revisionReloadingConversationId:
          state.revisionReloadingConversationId === key
            ? null
            : state.revisionReloadingConversationId,
      }));
      throw error;
    }
  },

  reconcileClientLease: async (
    conversationId,
    messageId,
    sessionId,
    leaseId,
    turnId,
  ) => {
    const result = await get().reloadTurnSnapshot(conversationId);
    if (turnId && result.turnId !== turnId) {
      throw new Error('chat.agentTurnRecovery.reloadTargetChanged');
    }
    if (result.terminal) return;
    set((state) => {
      const clear = (messages: ChatMessage[]) => messages.map((message) =>
        clearReconciledClientLeaseError(
          message,
          messageId,
          sessionId,
          leaseId,
          turnId,
        ));
      const isCurrent = state.currentSessionKey === conversationId;
      return {
        messages: isCurrent ? clear(state.messages) : state.messages,
        sessionBuffers: {
          ...state.sessionBuffers,
          [conversationId]: clear(
            state.sessionBuffers[conversationId] ?? [],
          ),
        },
      };
    });
  },

  syncTurnQueue: async (conversationId) => {
    const key = conversationId || get().currentSessionKey;
    if (isAgentDraftKey(key)) return;
    try {
      const queue = await api.listAgentTurnQueue(key);
      set((state) => ({
        turnQueues: {
          ...state.turnQueues,
          [key]: queue,
        },
      }));
    } catch (error) {
      log.warn('chat', 'Failed to reconcile Agent turn queue', {
        conversationId: key,
        error: String(error),
      });
    }
  },

  cancelQueuedTurn: async (conversationId, queueEntryId) => {
    const queue = get().turnQueues[conversationId];
    const version = queue?.conversation_version
      ?? await stationConversationVersion(conversationId);
    await api.cancelQueuedAgentTurn({
      conversation_id: conversationId,
      queue_entry_id: queueEntryId,
      idempotency_key: tempId(),
      expected_conversation_version: version,
    });
    await get().syncTurnQueue(conversationId);
    await get().loadSessions();
  },

  sendMessage: (
    content: string,
    attachments: ChatComposerAttachment[] = [],
    lifecycle?: AgentSendLifecycle,
  ) => {
    log.info('chat', 'Sending message', { sessionKey: get().currentSessionKey, contentLength: content.length });
    const { currentSessionKey } = get();
    const isDraft = isAgentDraftKey(currentSessionKey);
    const effectiveConvId = isDraft
      ? conversationIdFromAgentDraftKey(currentSessionKey) ?? ''
      : currentSessionKey;
    const agentState = useAgentStore.getState();
    const { selectedAgent } = agentState;
    const agentName = selectedAgent || 'assistant';
    const agentId = resolveAgentExecutionID(agentName);
    if (!agentId) {
      set({ readinessErrorKey: 'chat.agentReadiness.agentRequired' });
      return false;
    }
    set({ readinessErrorKey: null });

    const userMsg: ChatMessage = {
      id: tempId(),
      role: 'user',
      content,
      attachments,
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
    };

    const startedAt = Date.now();
    const assistantId = assistantMsg.id;
    let resolvedSessionKey = currentSessionKey;
    let acceptedByStation = false;
    const attachmentDiagnostic = attachments.length > 0;
    const notifyAccepted = () => {
      if (acceptedByStation) return;
      acceptedByStation = true;
      lifecycle?.onAccepted?.();
    };
    if (attachmentDiagnostic) {
      reportFoundationAttachmentReceiverDebug('N-P', 'stream-started', {
        currentSessionPresent: currentSessionKey.length > 0,
        currentSessionMatches: get().currentSessionKey === currentSessionKey,
        assistantPresent: get().messages.some(
          (message) => message.id === assistantId,
        ),
        bufferedAssistantPresent: (
          get().sessionBuffers[currentSessionKey] ?? []
        ).some((message) => message.id === assistantId),
      });
    }

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        effectiveConvId,
        agentId,
        content,
        attachments,
        lifecycle?.requestedBudget,
        lifecycle?.clientIdempotencyKey,
      ),
      (event: StreamEvent) => {
        if (streamEventConfirmsAdmission(event)) notifyAccepted();
        if (event.event === 'conversation_created' && typeof event.data?.conversation_id === 'string' && isDraft) {
          const realConvId = event.data.conversation_id.trim();
          let promotedSession: Session | undefined;
          set((state) => {
            const existingPromotion = state.draftPromotions[currentSessionKey];
            if (existingPromotion) {
              if (existingPromotion !== realConvId) {
                log.error('chat', 'Draft received conflicting conversation promotion', {
                  draftKey: currentSessionKey,
                  existingConversationId: existingPromotion,
                  receivedConversationId: realConvId,
                });
              }
              return state;
            }
            const byKey = new Map(state.sessions.map((s) => [s.key, s]));
            const draft = byKey.get(currentSessionKey);
            byKey.delete(currentSessionKey);
            const now = new Date().toISOString();
            promotedSession = {
              id: realConvId,
              key: realConvId,
              agent_name: draft?.agent_name || agentName,
              title: draft?.title || '',
              message_count: draft?.message_count || 0,
              model_override: draft?.model_override,
              created_at: draft?.created_at || now,
              updated_at: now,
            };
            byKey.set(realConvId, promotedSession);
            const nextOps = { ...state.operations };
            const existing = nextOps[currentSessionKey];
            delete nextOps[currentSessionKey];
            if (existing) {
              nextOps[realConvId] = { ...existing, sessionKey: realConvId };
            }
            const nextBuffers = { ...state.sessionBuffers };
            const draftBuffer = nextBuffers[currentSessionKey];
            delete nextBuffers[currentSessionKey];
            if (draftBuffer) nextBuffers[realConvId] = draftBuffer;
            const isCurrent = state.currentSessionKey === currentSessionKey;
            return {
              currentSessionKey: isCurrent ? realConvId : state.currentSessionKey,
              sessions: Array.from(byKey.values()),
              operations: nextOps,
              sessionBuffers: nextBuffers,
              draftPromotions: {
                ...state.draftPromotions,
                [currentSessionKey]: realConvId,
              },
              ...(isCurrent ? { abortController: controller } : {}),
            };
          });
          resolvedSessionKey =
            get().draftPromotions[currentSessionKey] || resolvedSessionKey;
          if (promotedSession) {
            log.info('chat', 'Draft session resolved to real conversation', {
              draftKey: currentSessionKey,
              convId: resolvedSessionKey,
            });
            useAgentTopicStore
              .getState()
              .promoteDraftTopic(agentId, currentSessionKey, promotedSession);
          }
        }
        set((state) => {
          const operationEvent = applyOperationEventIdentity(
            state.operations,
            resolvedSessionKey,
            event,
          );
          if (!operationEvent.accepted) return state;
          toolRuntime.consume(event);
          const isCurrent = state.currentSessionKey === resolvedSessionKey;
          const applyTo = (list: ChatMessage[]): ChatMessage[] => {
            const idx = list.findIndex((m) => m.id === assistantId);
            if (idx === -1) return list;
            const next = [...list];
            next[idx] = applyProjectedStreamEvent(next[idx], event);
            return next;
          };
          const sessionBuffers = setBuffer(state.sessionBuffers, resolvedSessionKey, applyTo);
          if (!isCurrent) {
            return { sessionBuffers, operations: operationEvent.operations };
          }
          return {
            sessionBuffers,
            operations: operationEvent.operations,
            messages: applyTo(state.messages),
          };
        });
        if (
          event.event === 'queued'
          && !isAgentDraftKey(resolvedSessionKey)
        ) {
          void get().syncTurnQueue(resolvedSessionKey);
        }
      },
      () => {
        notifyAccepted();
        log.info('chat', 'Stream complete');
        set((state) => {
          const isCurrent = state.currentSessionKey === resolvedSessionKey;
          return {
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: clearOperation(state.operations, resolvedSessionKey),
            sessionBuffers: clearBuffer(state.sessionBuffers, resolvedSessionKey),
          };
        });
        get().loadSessions();
        if (!isAgentDraftKey(resolvedSessionKey)) {
          void agentChatCache.syncConversation(resolvedSessionKey).catch((syncError) => {
            log.warn('chat', 'Post-turn cache sync failed', { key: resolvedSessionKey, error: String(syncError) });
          });
        }
        void get().syncMessages();
        reconcileTopicsAfterTurn(resolvedSessionKey);
      },
      (err: AgentTurnStreamError) => {
        const failedOperation = get().operations[resolvedSessionKey];
        const rejectedBeforeAdmission =
          !acceptedByStation && !failedOperation?.turnId;
        const attachmentRejected =
          err.typedError?.error_type === 'CONTEXT_ATTACHMENT_REJECTED';
        if (attachmentDiagnostic && attachmentRejected) {
          const stateBeforeError = get();
          reportFoundationAttachmentReceiverDebug(
            'N-P',
            'error-callback-entered',
            {
              acceptedByStation,
              currentSessionMatches:
                stateBeforeError.currentSessionKey === resolvedSessionKey,
              assistantPresent: stateBeforeError.messages.some(
                (message) => message.id === assistantId,
              ),
              bufferedAssistantPresent: (
                stateBeforeError.sessionBuffers[resolvedSessionKey] ?? []
              ).some((message) => message.id === assistantId),
              operationPresent:
                stateBeforeError.operations[resolvedSessionKey] !== undefined,
              operationRunState:
                stateBeforeError.operations[resolvedSessionKey]?.runState
                ?? null,
            },
          );
        }
        if (rejectedBeforeAdmission) lifecycle?.onRejected?.(err.typedError);
        log.error('chat', 'Send message failed', { error: err.message });
        const mappedResolution = resolveAgentTypedErrorAction(err.typedError);
        const resolution = mappedResolution ?? (
          err.resolution?.type === 'chooseResourceAgain'
          || err.resolution?.type === 'removeReference'
            ? undefined
            : err.resolution
        );
        set((state) => {
          const isCurrent = state.currentSessionKey === resolvedSessionKey;
          const applyError = (m: ChatMessage): ChatMessage => {
            if (m.id !== assistantId) return m;
            if (resolution) {
              return {
                ...m,
                error: err.message,
                typedError: err.typedError ?? m.typedError,
                errorDetail: err.errorDetail || m.errorDetail,
                resolution,
                providerId: err.providerId || m.providerId,
                loading: false,
              };
            }
            return {
              ...m,
              error: presentChatRuntimeError(err.message),
              typedError: err.typedError ?? m.typedError,
              resolution: undefined,
              loading: false,
            };
          };
          return {
            messages: isCurrent ? state.messages.map(applyError) : state.messages,
            // Pre-admission rejection has no Station message to reload, so its
            // editable draft and recovery surface remain conversation-scoped.
            sessionBuffers: rejectedBeforeAdmission
              ? setBuffer(
                  state.sessionBuffers,
                  resolvedSessionKey,
                  (messages) => messages.map(applyError),
                )
              : clearBuffer(state.sessionBuffers, resolvedSessionKey),
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: failOperationInMap(state.operations, resolvedSessionKey, err.message),
          };
        });
        if (attachmentDiagnostic && attachmentRejected) {
          const stateAfterError = get();
          const currentAssistant = stateAfterError.messages.find(
            (message) => message.id === assistantId,
          );
          const bufferedAssistant = (
            stateAfterError.sessionBuffers[resolvedSessionKey] ?? []
          ).find((message) => message.id === assistantId);
          reportFoundationAttachmentReceiverDebug(
            'N-Q',
            'error-state-projected',
            {
              currentSessionMatches:
                stateAfterError.currentSessionKey === resolvedSessionKey,
              assistantPresent: currentAssistant !== undefined,
              assistantErrorPresent: Boolean(currentAssistant?.error),
              assistantTypedError:
                currentAssistant?.typedError?.error_type ?? null,
              bufferedAssistantPresent: bufferedAssistant !== undefined,
              bufferedAssistantErrorPresent: Boolean(bufferedAssistant?.error),
              bufferedAssistantTypedError:
                bufferedAssistant?.typedError?.error_type ?? null,
              operationRunState:
                stateAfterError.operations[resolvedSessionKey]?.runState
                ?? null,
              isStreaming: stateAfterError.isStreaming,
            },
          );
        }
        if (!rejectedBeforeAdmission) {
          reconcileTopicsAfterTurn(resolvedSessionKey);
        }
      },
      currentAuthenticatedActorPtid() || '',
    );

    set((state) => {
      const retainedMessages = discardPreAdmissionFailureMessages(
        state.messages,
        state.operations[currentSessionKey],
      );
      const baseMessages = [...retainedMessages, userMsg, assistantMsg];
      return {
        messages: baseMessages,
        isStreaming: true,
        streamingStartedAt: startedAt,
        abortController: controller,
        operations: {
          ...state.operations,
          [currentSessionKey]: createOperation({
            sessionKey: currentSessionKey,
            type: 'sendMessage',
            assistantMessageId: assistantId,
            abortController: controller,
            streamGeneration: controller.streamGeneration,
          }),
        },
        sessionBuffers: { ...state.sessionBuffers, [currentSessionKey]: baseMessages },
      };
    });
    if (attachmentDiagnostic) {
      const installedState = get();
      const currentAssistant = installedState.messages.find(
        (message) => message.id === assistantId,
      );
      const bufferedAssistant = (
        installedState.sessionBuffers[currentSessionKey] ?? []
      ).find((message) => message.id === assistantId);
      reportFoundationAttachmentReceiverDebug(
        'N-P',
        'optimistic-state-installed',
        {
          currentSessionMatches:
            installedState.currentSessionKey === currentSessionKey,
          assistantPresent: currentAssistant !== undefined,
          assistantErrorPresent: Boolean(currentAssistant?.error),
          bufferedAssistantPresent: bufferedAssistant !== undefined,
          bufferedAssistantErrorPresent: Boolean(bufferedAssistant?.error),
          operationPresent:
            installedState.operations[currentSessionKey] !== undefined,
          operationRunState:
            installedState.operations[currentSessionKey]?.runState ?? null,
          isStreaming: installedState.isStreaming,
        },
      );
    }
    return true;
  },

  regenerateMessage: async (messageId: string) => {
    const { currentSessionKey, isStreaming } = get();
    if (isStreaming) return;
    try {
      const version = await revisionCommandVersion(
        currentSessionKey,
        get().sessions,
      );
      await api.regenerateAgentTurn({
        conversation_id: currentSessionKey,
        source_assistant_message_id: messageId,
        client_idempotency_key: tempId(),
        expected_conversation_version: version,
      });
      await agentChatCache.clearConversation(currentSessionKey);
      await get().syncMessages();
      await get().loadSessions();
    } catch (error) {
      const failure = projectAgentRevisionCommandFailure(
        error,
        currentSessionKey,
      );
      if (failure) {
        set({ revisionCommandFailure: failure });
        return;
      }
      throw error;
    }
  },

  retryMessage: (messageId: string) => {
    const { currentSessionKey, messages, isStreaming } = get();
    const source = messages.find((message) => message.id === messageId);
    const sourceTurnId = source?.turnId;
    const operation = get().operations[currentSessionKey];
    const retryBlocked = isMessageRetryBlocked(
      isStreaming,
      operation,
      sourceTurnId,
      source?.terminalStatus,
    );
    const retryKey = `${currentSessionKey}:${messageId}`;
    const pending = pendingMessageRetries.get(retryKey);

    // #region debug-point A-B-E:retry-entry
    reportApprovalExpiryRetryDebug('A-B-E', 'retry-entry', {
      isStreaming,
      sourcePresent: Boolean(source),
      sourceTurnPresent: Boolean(sourceTurnId),
      sourceTerminalStatus: source?.terminalStatus ?? null,
      sourceLoading: source?.loading === true,
      operationPresent: Boolean(operation),
      operationRunState: operation?.runState ?? null,
      operationTurnMatchesSource:
        Boolean(sourceTurnId) && operation?.turnId === sourceTurnId,
      retryBlocked,
      pendingRetryPresent: Boolean(pending),
    });
    // #endregion

    if (retryBlocked) {
      // #region debug-point A:streaming-guard
      reportApprovalExpiryRetryDebug('A', 'retry-skipped-streaming', {});
      // #endregion
      return Promise.resolve();
    }
    if (!sourceTurnId) {
      // #region debug-point B:source-guard
      reportApprovalExpiryRetryDebug('B', 'retry-skipped-source', {
        sourcePresent: Boolean(source),
      });
      // #endregion
      return Promise.resolve();
    }

    if (pending) {
      // #region debug-point E:single-flight
      reportApprovalExpiryRetryDebug('E', 'retry-single-flight-reused', {});
      // #endregion
      return pending;
    }

    const request = (async () => {
      try {
        const version = await revisionCommandVersion(
          currentSessionKey,
          get().sessions,
        );
        // #region debug-point C:retry-api-start
        reportApprovalExpiryRetryDebug('C', 'retry-api-start', {
          conversationVersionPresent: Number.isInteger(version) && version > 0,
        });
        // #endregion
        const response = await api.retryAgentTurn({
          conversation_id: currentSessionKey,
          source_turn_id: sourceTurnId,
          client_idempotency_key: tempId(),
          expected_conversation_version: version,
        });
        // #region debug-point D:retry-api-complete
        reportApprovalExpiryRetryDebug('D', 'retry-api-complete', {
          hasTurn: Boolean(response.turn),
          hasAttempt: Boolean(response.attempt),
          hasConversation: Boolean(response.conversation),
          turnStatus: (
            response.turn && typeof response.turn === 'object'
              ? String((response.turn as Record<string, unknown>).status ?? '')
              : ''
          ),
        });
        // #endregion
        if (get().currentSessionKey === currentSessionKey) {
          await get().syncMessages();
        }
        await get().loadSessions();
      } catch (error) {
        const stableCode = String(error).match(/\b(?:AGENT|TOOL|LIFECYCLE)_[A-Z0-9_]+\b/)?.[0] ?? null;
        // #region debug-point C:retry-api-error
        reportApprovalExpiryRetryDebug('C', 'retry-api-error', {
          errorName: error instanceof Error ? error.name : typeof error,
          stableCode,
        });
        // #endregion
        const failure = projectAgentRevisionCommandFailure(
          error,
          currentSessionKey,
        );
        if (failure) {
          set({ revisionCommandFailure: failure });
          return;
        }
        throw error;
      }
    })().finally(() => {
      pendingMessageRetries.delete(retryKey);
    });
    pendingMessageRetries.set(retryKey, request);
    return request;
  },

  deleteAndRegenerateMessage: async (messageId: string) => {
    await get().regenerateMessage(messageId);
  },

  branchFromMessage: async (messageId: string) => {
    const { currentSessionKey } = get();
    try {
      const version = await revisionCommandVersion(
        currentSessionKey,
        get().sessions,
      );
      await api.selectAgentActiveBranch({
        conversation_id: currentSessionKey,
        active_branch_message_id: messageId,
        client_idempotency_key: tempId(),
        expected_conversation_version: version,
      });
      await agentChatCache.clearConversation(currentSessionKey);
      await get().syncMessages();
      await get().loadSessions();
    } catch (error) {
      const failure = projectAgentRevisionCommandFailure(
        error,
        currentSessionKey,
      );
      if (failure) {
        set({ revisionCommandFailure: failure });
        return;
      }
      throw error;
    }
  },

  requestTurnCancellation: async (turnId, assistantMessageId) => {
    try {
      await api.cancelAgentTurn(turnId);
    } catch (error) {
      const normalized = normalizeAgentTurnStreamError(error);
      const typedError = normalized.typedError;
      const resolution = normalized.resolution;
      if (
        !isAgentLifecycleTerminalMutationError(typedError)
        || resolution?.type !== 'openResult'
        || resolution.resourceId !== turnId
        || resolution.turnId !== turnId
        || resolution.terminalStatus !== typedError.details.terminal_status
      ) {
        throw error;
      }

      let projected = false;
      const projectMessages = (messages: ChatMessage[]): ChatMessage[] => {
        let changed = false;
        const next = messages.map((message) => {
          const projectedMessage = projectAgentTerminalMutationMessage(
            message,
            normalized,
            turnId,
            assistantMessageId,
          );
          if (projectedMessage !== message) {
            projected = true;
            changed = true;
          }
          return projectedMessage;
        });
        return changed ? next : messages;
      };
      set((state) => {
        const sessionBuffers = Object.fromEntries(
          Object.entries(state.sessionBuffers).map(([key, messages]) => [
            key,
            projectMessages(messages),
          ]),
        );
        return {
          messages: projectMessages(state.messages),
          sessionBuffers,
        };
      });
      if (!projected) throw normalized;
    }
  },

  stopStreaming: () => {
    get().stopOperation(get().currentSessionKey);
  },

  stopOperation: (sessionKey: string) => {
    log.info('chat', 'Streaming stopped', { sessionKey });
    const op = get().operations[sessionKey];
    if (!op || !isActiveOperation(op)) return;
    if (op.turnId) {
      void get().requestTurnCancellation(op.turnId, op.assistantMessageId)
        .catch((error) => {
          log.warn('chat', 'Agent turn cancellation failed', {
            turnId: op.turnId,
            error: String(error),
          });
        });
    }
    const cancelled = cancelOperation(op);
    set((state) => {
      const isCurrent = state.currentSessionKey === sessionKey;
      const finalizeList = (list: ChatMessage[]): ChatMessage[] =>
        list.map((m) => (m.loading ? { ...m, loading: false } : m));
      return {
        messages: isCurrent ? finalizeList(state.messages) : state.messages,
        sessionBuffers: setBuffer(state.sessionBuffers, sessionKey, finalizeList),
        isStreaming: isCurrent ? false : state.isStreaming,
        streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
        abortController: isCurrent ? null : state.abortController,
        operations: { ...state.operations, [sessionKey]: cancelled },
      };
    });
  },

  deleteMessage: async (id: string) => {
    const { currentSessionKey } = get();
    if (isOptimisticMessageId(id)) {
      set((state) => {
        const messages = discardPreAdmissionFailureMessages(
          state.messages,
          state.operations[currentSessionKey],
          id,
        );
        if (messages === state.messages) return state;
        return {
          messages,
          operations: removeOperation(state.operations, currentSessionKey),
          sessionBuffers: clearBuffer(state.sessionBuffers, currentSessionKey),
        };
      });
      return;
    }
    try {
      const version = await revisionCommandVersion(
        currentSessionKey,
        get().sessions,
      );
      await api.tombstoneAgentMessage({
        conversation_id: currentSessionKey,
        message_id: id,
        client_idempotency_key: tempId(),
        expected_conversation_version: version,
        destructive_confirmed: true,
        reason: 'user_requested',
      });
      await agentChatCache.clearConversation(currentSessionKey);
      await get().syncMessages();
      await get().loadSessions();
    } catch (error) {
      const failure = projectAgentRevisionCommandFailure(
        error,
        currentSessionKey,
      );
      if (failure) {
        set({ revisionCommandFailure: failure });
        return;
      }
      throw error;
    }
  },

  editMessage: async (id: string, content: string) => {
    if (id.startsWith('temp-')) return;
    const { currentSessionKey } = get();
    try {
      const version = await revisionCommandVersion(
        currentSessionKey,
        get().sessions,
      );
      await api.editAndResendAgentMessage({
        conversation_id: currentSessionKey,
        source_user_message_id: id,
        revised_content: content,
        client_idempotency_key: tempId(),
        expected_conversation_version: version,
      });
      await agentChatCache.clearConversation(currentSessionKey);
      await get().syncMessages();
      await get().loadSessions();
    } catch (error) {
      const failure = projectAgentRevisionCommandFailure(
        error,
        currentSessionKey,
      );
      if (failure) {
        set({ revisionCommandFailure: failure });
        return;
      }
      throw error;
    }
  },

  translateMessage: async (id: string) => {
    const { messages } = get();
    const target = messages.find((m) => m.id === id);
    if (!target || !target.content) return;
    if (target.translation) {
      set((s) => ({
        messages: s.messages.map((m) => m.id === id ? { ...m, translation: undefined } : m),
      }));
      // Clear the persisted translation (no-op for optimistic temp ids).
      if (!id.startsWith('temp-')) {
        try { await api.updateMessageTranslate(id, ''); } catch { /* clear best-effort */ }
      }
      return;
    }
    const agentId = useAgentStore.getState().selectedAgent;
    if (!agentId) return;
    const userLang = navigator.language.startsWith('zh') ? 'English' : '中文';
    const prompt = `Translate the following text to ${userLang}. Return ONLY the translation, no explanation.\n\n${target.content}`;
    try {
      const result = await api.quickCompletion(agentId, prompt);
      set((s) => ({
        messages: s.messages.map((m) => m.id === id ? { ...m, translation: result } : m),
      }));
      // Persist the translation to Station (metadata_json); skip optimistic temp ids.
      if (!id.startsWith('temp-')) {
        try { await api.updateMessageTranslate(id, result); } catch { /* persist best-effort */ }
      }
    } catch { /* translation unavailable */ }
  },

  continueGeneration: (messageId: string) => {
    const { messages } = get();
    const target = messages.find((m) => m.id === messageId);
    if (!target || target.role !== 'assistant') return;
    // Real continuation: feed the already-generated content back as context so the
    // model picks up where it stopped, rather than re-prompting a bare "continue".
    // (Peers turn always appends a user message + loads full history, so the model
    // sees the prior assistant content; carrying it explicitly makes continuation
    // reliable and provider-agnostic. Topology differs from LobeHub same-bubble
    // assistant prefill — accepted as 能力对齐/拓扑不同.)
    const priorContent = (target.content || '').trim();
    const prompt = priorContent
      ? i18n.t('chat.message.continueWithContext', { ns: 'chat', content: priorContent })
      : i18n.t('chat.message.continuePrompt', { ns: 'chat' });
    get().sendMessage(prompt);
  },


  setWideScreen: (wide: boolean) => {
    set({ wideScreen: wide });
    api.setPreferences({ wide_screen: wide }).catch(() => {});
  },

  // Request the composer to be filled with `text` without sending. The nonce lets
  // ChatInput react even when the same suggestion text is chosen twice in a row.
  fillComposer: (text: string) => {
    set({ composerFill: { text, nonce: Date.now() } });
  },

  consumeComposerFill: () => {
    set({ composerFill: null });
  },

  requestComposerReferenceRemoval: (referenceKind, referenceHash) => {
    composerReferenceRemovalCounter += 1;
    set({
      composerReferenceRemoval: {
        sessionKey: get().currentSessionKey,
        referenceKind,
        referenceHash,
        nonce: composerReferenceRemovalCounter,
      },
    });
  },

  consumeComposerReferenceRemoval: (nonce) => {
    set((state) => (
      state.composerReferenceRemoval?.nonce === nonce
        ? { composerReferenceRemoval: null }
        : {}
    ));
  },

  requestComposerResourceSelection: (resourceKind, resourceRefHash) => {
    composerResourceSelectionCounter += 1;
    set({
      composerResourceSelection: {
        sessionKey: get().currentSessionKey,
        resourceKind,
        resourceRefHash,
        nonce: composerResourceSelectionCounter,
      },
    });
  },

  consumeComposerResourceSelection: (nonce) => {
    set((state) => (
      state.composerResourceSelection?.nonce === nonce
        ? { composerResourceSelection: null }
        : {}
    ));
  },

  requestComposerFocus: () => {
    set((state) => ({
      composerFocusNonce: state.composerFocusNonce + 1,
    }));
  },

  consumeComposerFocus: () => {
    set({ composerFocusNonce: 0 });
  },

  toggleSessionMemory: (sessionKey?: string) => {
    const key = sessionKey || get().currentSessionKey;
    const { memoryDisabledSessions } = get();
    set({
      memoryDisabledSessions: {
        ...memoryDisabledSessions,
        [key]: !memoryDisabledSessions[key],
      },
    });
  },

  isMemoryDisabled: (sessionKey?: string) => {
    const key = sessionKey || get().currentSessionKey;
    return get().memoryDisabledSessions[key] || false;
  },

  loadPreferences: async () => {
    try {
      const prefs = await api.getPreferences();
      set({ wideScreen: prefs.wide_screen || false });
    } catch {
      // keep defaults
    }
  },
}));
