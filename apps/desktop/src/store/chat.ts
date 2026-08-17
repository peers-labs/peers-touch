import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import i18n, { resolveI18nValue } from '../i18n/index';
import {
  api,
  streamAgentCollaborationEvents,
  type Session,
  type StreamEvent,
  type ChatAttachmentInput,
  type AgentExecuteTurnKnowledgeResource,
} from '../services/desktop_api';
import { agentService } from '../services/agent-service';
import { buildAgentRuntimeConfig } from '../services/agent-runtime-config';
import { resolveAgentModelRef, useAgentStore } from './agent';
import { useAgentTopicStore } from './agentTopics';
import { createAgentDraftKey, isAgentDraftKey } from './agentDraft';
import { getDesktopAgentChatCache } from '../storage/desktopAgentChatCache';
import type { CachedAgentConversation, CachedAgentMessage } from '@peers-touch/client-chat-core';
import {
  reduceStreamEvent,
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

export type ToolCallStatus = 'queued' | 'approval_required' | 'approved' | 'denied' | 'pending' | 'success' | 'error' | 'cancelled';
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
  attachment?: ChatAttachmentInput;
}

export interface ErrorResolutionAction {
  type: 'reauthCli' | 'openProviderSettings' | 'checkConnection';
  cliId?: string;
  providerId?: string;
  label: string;
}

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
}

const agentChatCache = getDesktopAgentChatCache();

function cachedConversationToSession(conversation: CachedAgentConversation): Session {
  return {
    id: conversation.conversationId,
    key: conversation.conversationId,
    agent_name: conversation.agentId,
    title: resolveI18nValue(conversation.title) || '',
    message_count: 0,
    model_override: conversation.modelName,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt,
  };
}

function cachedMessageToChatMessage(message: CachedAgentMessage): ChatMessage {
  const chatMessage: ChatMessage = {
    id: message.messageId,
    role: message.role,
    content: message.content,
    contentType: 'text',
    timestamp: new Date(message.createdAt).getTime(),
    model: message.modelName,
  };
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
      const parsed = JSON.parse(message.toolCallsJson) as Array<{ id?: string; name?: string; args?: string; result?: string }>;
      chatMessage.toolCalls = parsed.map((toolCall) => ({
        id: toolCall.id || toolCall.name || '',
        name: toolCall.name || 'tool',
        args: toolCall.args,
        result: toolCall.result,
        pending: false,
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

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith('temp-');
}

function isInFlightMessage(message: ChatMessage): boolean {
  return message.loading === true || Boolean(message.error);
}

function carryChainOfThoughtFields(target: ChatMessage, source: ChatMessage): ChatMessage {
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
    || source.errorDetail
    || source.resolution;
  if (!hasCot) return target;
  return {
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
    error: target.error ?? source.error,
    errorDetail: target.errorDetail ?? source.errorDetail,
    resolution: target.resolution ?? source.resolution,
  };
}

export function mergeServerMessages(currentMessages: ChatMessage[], serverMessages: ChatMessage[]): ChatMessage[] {
  const currentById = new Map<string, ChatMessage>();
  for (const message of currentMessages) currentById.set(message.id, message);

  const merged: ChatMessage[] = serverMessages.map((serverMessage) => {
    const match = currentById.get(serverMessage.id);
    if (!match) return serverMessage;
    return carryChainOfThoughtFields(serverMessage, match);
  });

  const mergedIds = new Set(merged.map((message) => message.id));

  for (const message of currentMessages) {
    if (mergedIds.has(message.id)) continue;
    const isLocalOnly = isOptimisticMessageId(message.id) || isInFlightMessage(message);
    if (!isLocalOnly) continue;
    if (isSupersededByServer(message, merged)) continue;
    merged.push(message);
  }

  return merged;
}

function isSupersededByServer(localMessage: ChatMessage, serverMessages: ChatMessage[]): boolean {
  if (localMessage.role === 'user') {
    return serverMessages.some(
      (serverMessage) => serverMessage.role === 'user'
        && serverMessage.content === localMessage.content
        && serverMessage.timestamp >= localMessage.timestamp - 1000,
    );
  }
  if (localMessage.role === 'assistant') {
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

interface ChatState {
  sessions: Session[];
  currentSessionKey: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingStartedAt: number | null;
  operations: Record<string, ChatOperation>;
  sessionBuffers: Record<string, ChatMessage[]>;
  abortController: AbortController | null;
  memoryDisabledSessions: Record<string, boolean>;
  draftPromotions: Record<string, string>;
  readinessErrorKey: string | null;


  wideScreen: boolean;

  // Composer fill channel (I2 follow-up): a one-shot request to populate the ChatInput
  // draft WITHOUT sending, aligning with LobeHub `fillInputMessage`. ChatInput consumes
  // the pending value, writes it into its draft, focuses, and clears the request.
  composerFill: { text: string; nonce: number } | null;

  loadSessions: () => Promise<void>;
  mergeSessions: (sessions: Session[]) => void;
  mergeSessionModel: (key: string, model: string, agentId: string) => void;
  selectSession: (key: string, sessionOverride?: Session) => Promise<void>;
  bootstrapSession: () => Promise<void>;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  sendMessage: (content: string, attachments?: ChatComposerAttachment[]) => boolean;
  regenerateMessage: (messageId: string) => void;
  retryMessage: (messageId: string) => void;
  deleteAndRegenerateMessage: (messageId: string) => void;
  branchFromMessage: (messageId: string) => Promise<void>;
  decideToolApproval: (approvalId: string, approved: boolean) => Promise<void>;
  stopStreaming: () => void;
  stopOperation: (sessionKey: string) => void;
  continueGeneration: (messageId: string) => void;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  translateMessage: (id: string) => Promise<void>;

  syncMessages: () => Promise<void>;
  setWideScreen: (wide: boolean) => void;
  fillComposer: (text: string) => void;
  consumeComposerFill: () => void;
  toggleSessionMemory: (sessionKey?: string) => void;
  isMemoryDisabled: (sessionKey?: string) => boolean;
  loadPreferences: () => Promise<void>;
}

let messageCounter = 0;
function tempId() {
  return `temp-${Date.now()}-${messageCounter++}`;
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
  return reduceStreamEvent(msg, event as TurnStreamEvent);
}

function finalizeToolCalls(msg: ChatMessage, status: ToolCallStatus = 'success'): ChatMessage {
  if (!msg.toolCalls?.some((tc) => tc.pending)) return msg;
  return {
    ...msg,
    toolCalls: msg.toolCalls!.map((tc) =>
      tc.pending ? { ...tc, pending: false, status } : tc,
    ),
    loading: false,
  };
}

function buildAgentTurnInput(
  conversationId: string,
  agentId: string,
  userInput: string,
  attachments: ChatComposerAttachment[],
  providerId: string,
  model?: string,
  runtimeConfig?: {
    workspaceRoot?: string;
    contextWindowSize?: number;
    maxRetries?: number;
    knowledgeResources?: AgentExecuteTurnKnowledgeResource[];
    identity?: string;
    agentConfigPrompt?: string;
    effort?: string;
    provider?: string;
    model?: string;
    cliCommand?: string;
    workspaceMode?: string;
    runtimeBackend?: string;
    rootfsPath?: string;
    allowedRoots?: string[];
  },
  memoryDisabled?: boolean,
) {
  return {
    conversation_id: conversationId,
    agent_id: agentId,
    user_input: userInput,
    attachments: attachments.map((item) => item.attachment).filter((item): item is ChatAttachmentInput => Boolean(item)),
    provider: providerId || runtimeConfig?.provider || undefined,
    model: model || runtimeConfig?.model || undefined,
    cli_command: runtimeConfig?.cliCommand || undefined,
    workspace_mode: runtimeConfig?.workspaceMode || undefined,
    runtime_backend: runtimeConfig?.runtimeBackend || undefined,
    rootfs_path: runtimeConfig?.rootfsPath || undefined,
    allowed_roots: runtimeConfig?.allowedRoots,
    identity: runtimeConfig?.identity || undefined,
    agent_config_prompt: runtimeConfig?.agentConfigPrompt || undefined,
    effort: runtimeConfig?.effort || undefined,
    platform: 'desktop',
    workspace_root: runtimeConfig?.workspaceRoot || undefined,
    context_window_size: runtimeConfig?.contextWindowSize,
    max_retries: runtimeConfig?.maxRetries,
    knowledge_resources: runtimeConfig?.knowledgeResources,
    memory_disabled: memoryDisabled || undefined,
  };
}

function resolveAgentExecutionRef(agentName: string): {
  agentId: string;
  provider: string;
  model: string;
  runtimeConfig: ReturnType<typeof buildAgentRuntimeConfig>;
} | null {
  const agentState = useAgentStore.getState();
  const agent = agentState.agents.find((item) => item.name === agentName);
  if (!agent) return null;
  const ref = resolveAgentModelRef(agent, agentState.availableModels);
  if (!ref) return null;
  return {
    agentId: agent.id,
    ...ref,
    runtimeConfig: buildAgentRuntimeConfig(agent),
  };
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

// Per chat root task cursor for the durable Station event outbox. The Station-hosted
// chat task (surface=CHAT) is the authoritative lifecycle owner; after a local turn
// stream ends we replay its outbox by cursor so projection state reconciles from
// Station rather than the transient desktop stream.
const chatTaskEventSeq: Record<string, number> = {};

function reconcileChatTaskOutbox(
  taskId: string,
  agentId: string,
  sessionKey: string,
  syncMessages: () => Promise<void>,
): void {
  if (!taskId || !agentId) {
    void syncMessages();
    reconcileTopicsAfterTurn(sessionKey);
    return;
  }
  const afterEventSeq = chatTaskEventSeq[taskId] || 0;
  let controller: AbortController | null = null;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    controller?.abort();
    void syncMessages();
    reconcileTopicsAfterTurn(sessionKey);
  };
  controller = streamAgentCollaborationEvents(
    agentId,
    (payload) => {
      if (!payload.event.startsWith('agent.collaboration.')) return;
      const metadata = (payload.data?.metadata || {}) as Record<string, unknown>;
      const eventSeq = Number(metadata.event_seq || 0);
      if (Number.isFinite(eventSeq) && eventSeq > (chatTaskEventSeq[taskId] || 0)) {
        chatTaskEventSeq[taskId] = eventSeq;
      }
      if (
        payload.event === 'agent.collaboration.node.completed'
        || payload.event === 'agent.collaboration.node.failed'
        || payload.event === 'agent.collaboration.task.completed'
        || payload.event === 'agent.collaboration.task.failed'
        || payload.event === 'agent.collaboration.task.cancelled'
      ) {
        settle();
      }
    },
    () => {
      // Outbox stream may be unavailable (e.g. http gateway dev mode); fall back to a
      // direct sync so the projection still settles from persisted messages.
      settle();
    },
    { taskId, afterEventSeq },
  );
}

function findRegenerationPrompt(messages: ChatMessage[], messageId: string): {
  userMsg: ChatMessage;
  msgIndex: number;
  responseIds: string[];
} | null {
  const msgIndex = messages.findIndex((m) => m.id === messageId);
  if (msgIndex === -1) return null;

  const msg = messages[msgIndex];
  let userMsg: ChatMessage | undefined;
  const responseIds: string[] = [];

  if (msg.role === 'assistant') {
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg) return null;
    const userIdx = messages.indexOf(userMsg);
    for (let i = userIdx + 1; i <= msgIndex; i++) {
      if (messages[i].role !== 'user') responseIds.push(messages[i].id);
    }
  } else if (msg.role === 'user') {
    userMsg = msg;
    for (let i = msgIndex + 1; i < messages.length; i++) {
      if (messages[i].role === 'user') break;
      responseIds.push(messages[i].id);
    }
  }

  if (!userMsg) return null;
  return { userMsg, msgIndex, responseIds };
}

function clearOperation(operations: Record<string, ChatOperation>, sessionKey: string): Record<string, ChatOperation> {
  const op = operations[sessionKey];
  if (!op) return operations;
  return { ...operations, [sessionKey]: completeOperation(op) };
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

export function applyOperationEventIdentity(
  operations: Record<string, ChatOperation>,
  sessionKey: string,
  event: StreamEvent,
): { operations: Record<string, ChatOperation>; accepted: boolean } {
  const operation = operations[sessionKey];
  if (!operation) return { operations, accepted: true };
  const seq = Number(event.data?.seq || 0);
  if (seq > 0 && (operation.lastEventSeq || 0) >= seq) {
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
  return {
    accepted: true,
    operations: {
      ...operations,
      [sessionKey]: {
        ...operation,
        turnId,
        conversationId,
        lastEventSeq: seq > 0 ? seq : operation.lastEventSeq,
        runState:
          event.event === 'reconciling' ? 'reconciling' : operation.runState,
      },
    },
  };
}

async function loadSessionMessages(
  key: string,
  get: () => ChatState,
  set: (partial: Partial<ChatState>) => void,
): Promise<void> {
  try {
    const cached = await agentChatCache.getMessages(key);
    if (get().currentSessionKey !== key) return;
    const cachedMessages = foldToolMessages(cached.map(cachedMessageToChatMessage));
    set({ messages: mergeServerMessages(get().messages, cachedMessages) });
    void agentChatCache
      .syncConversation(key)
      .then((synced) => {
        if (get().currentSessionKey !== key) return;
        const serverMessages = foldToolMessages(synced.map(cachedMessageToChatMessage));
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
  sessionBuffers: {},
  abortController: null,
  memoryDisabledSessions: {},
  draftPromotions: {},
  readinessErrorKey: null,


  wideScreen: false,
  composerFill: null,

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
    // Only adopt a buffered message list while a stream is actively running for
    // this session. A buffer with no live operation is stale (e.g. left behind
    // after an error) and must not short-circuit loading persisted history.
    const liveBuffer = isActiveOperation(liveOp) ? get().sessionBuffers[key] : undefined;
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
      await api.deleteSession(key);
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
    const { currentSessionKey, messages: currentMessages } = get();

    try {
      if (isAgentDraftKey(currentSessionKey)) {
        return;
      }
      const synced = await agentChatCache.syncConversation(currentSessionKey);
      if (get().currentSessionKey !== currentSessionKey) return;
      const serverMessages = foldToolMessages(synced.map(cachedMessageToChatMessage));

      const merged = mergeServerMessages(currentMessages, serverMessages);
      set({ messages: merged });
    } catch (error) {
      log.warn('chat', 'Failed to sync messages; keeping current view', { error: String(error) });
    }
  },

  sendMessage: (content: string, attachments: ChatComposerAttachment[] = []) => {
    log.info('chat', 'Sending message', { sessionKey: get().currentSessionKey, contentLength: content.length });
    const { currentSessionKey } = get();
    const isDraft = isAgentDraftKey(currentSessionKey);
    const effectiveConvId = isDraft ? '' : currentSessionKey;
    const agentState = useAgentStore.getState();
    const { selectedAgent } = agentState;
    const agentName = selectedAgent || 'assistant';
    const execution = resolveAgentExecutionRef(agentName);
    if (!execution) {
      set({ readinessErrorKey: 'chat.agentReadiness.modelRequired' });
      return false;
    }
    const {
      agentId,
      provider: effectiveProvider,
      model: effectiveModel,
      runtimeConfig,
    } = execution;
    set({ readinessErrorKey: null });

    const imageUrls = attachments
      .filter((item) => item.mime_type.startsWith('image/'))
      .map((item) => item.previewUrl || item.url || item.cid)
      .filter((value): value is string => Boolean(value));

    const userMsg: ChatMessage = {
      id: tempId(),
      role: 'user',
      content,
      images: imageUrls.length > 0 ? imageUrls : undefined,
      attachments,
      timestamp: Date.now(),
    };

    const usedModel = effectiveModel;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      model: usedModel || undefined,
    };

    const startedAt = Date.now();
    const assistantId = assistantMsg.id;
    let capturedTaskId = '';
    let resolvedSessionKey = currentSessionKey;

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        effectiveConvId,
        agentName,
        content,
        attachments,
        effectiveProvider,
        effectiveModel,
        runtimeConfig,
        get().isMemoryDisabled(currentSessionKey),
      ),
      (event: StreamEvent) => {
        if (typeof event.data?.task_id === 'string') capturedTaskId = event.data.task_id;
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
          const isCurrent = state.currentSessionKey === resolvedSessionKey;
          const applyTo = (list: ChatMessage[]): ChatMessage[] => {
            const idx = list.findIndex((m) => m.id === assistantId);
            if (idx === -1) return list;
            const next = [...list];
            next[idx] = applyStreamEvent(next[idx], event);
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
      },
      () => {
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
        reconcileChatTaskOutbox(capturedTaskId, agentName, resolvedSessionKey, () => get().syncMessages());
      },
      (err: Error & { resolution?: ErrorResolutionAction; errorDetail?: string; providerId?: string }) => {
        log.error('chat', 'Send message failed', { error: err.message });
        set((state) => {
          const isCurrent = state.currentSessionKey === resolvedSessionKey;
          const applyError = (m: ChatMessage): ChatMessage => {
            if (m.id !== assistantId) return m;
            if (err.resolution) {
              return {
                ...m,
                error: err.message,
                errorDetail: err.errorDetail || m.errorDetail,
                resolution: err.resolution,
                providerId: err.providerId || m.providerId,
                loading: false,
              };
            }
            return { ...m, error: presentChatRuntimeError(err.message), loading: false };
          };
          return {
            messages: isCurrent ? state.messages.map(applyError) : state.messages,
            // The stream has terminated; drop the live buffer so a later
            // selectSession reloads persisted history instead of adopting a
            // stale in-memory list.
            sessionBuffers: clearBuffer(state.sessionBuffers, resolvedSessionKey),
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: failOperationInMap(state.operations, resolvedSessionKey, err.message),
          };
        });
        reconcileTopicsAfterTurn(resolvedSessionKey);
      },
    );

    set((state) => {
      const baseMessages = [...state.messages, userMsg, assistantMsg];
      return {
        messages: baseMessages,
        isStreaming: true,
        streamingStartedAt: startedAt,
        abortController: controller,
        operations: {
          ...state.operations,
          [currentSessionKey]: createOperation({ sessionKey: currentSessionKey, type: 'sendMessage', assistantMessageId: assistantId, abortController: controller }),
        },
        sessionBuffers: { ...state.sessionBuffers, [currentSessionKey]: baseMessages },
      };
    });
    return true;
  },

  regenerateMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;

    const prompt = findRegenerationPrompt(messages, messageId);
    if (!prompt) return;

    const { currentSessionKey } = get();
    const agentState = useAgentStore.getState();
    const { selectedAgent } = agentState;
    const agentName = selectedAgent || 'assistant';
    const execution = resolveAgentExecutionRef(agentName);
    if (!execution) {
      set({ readinessErrorKey: 'chat.agentReadiness.modelRequired' });
      return;
    }
    const { provider: effectiveProvider, model: effectiveModel, runtimeConfig } = execution;
    set({ readinessErrorKey: null });
    const replacedId = prompt.responseIds[prompt.responseIds.length - 1] || messageId;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      model: effectiveModel,
      operation: 'regenerate',
      replacementOf: replacedId,
    };

    const startedAt = Date.now();
    const assistantId = assistantMsg.id;
    let capturedTaskId = '';

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        currentSessionKey,
        agentName,
        prompt.userMsg.content,
        prompt.userMsg.attachments || [],
        effectiveProvider,
        effectiveModel,
        runtimeConfig,
      ),
      (event: StreamEvent) => {
        if (typeof event.data?.task_id === 'string') capturedTaskId = event.data.task_id;
        set((state) => {
          const operationEvent = applyOperationEventIdentity(
            state.operations,
            currentSessionKey,
            event,
          );
          if (!operationEvent.accepted) return state;
          const isCurrent = state.currentSessionKey === currentSessionKey;
          const applyTo = (list: ChatMessage[]): ChatMessage[] => {
            const idx = list.findIndex((m) => m.id === assistantId);
            if (idx === -1) return list;
            const next = [...list];
            next[idx] = applyStreamEvent(next[idx], event);
            return next;
          };
          const sessionBuffers = setBuffer(state.sessionBuffers, currentSessionKey, applyTo);
          if (!isCurrent) {
            return { sessionBuffers, operations: operationEvent.operations };
          }
          return {
            sessionBuffers,
            operations: operationEvent.operations,
            messages: applyTo(state.messages),
          };
        });
      },
      () => {
        set((state) => {
          const isCurrent = state.currentSessionKey === currentSessionKey;
          return {
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: clearOperation(state.operations, currentSessionKey),
            sessionBuffers: clearBuffer(state.sessionBuffers, currentSessionKey),
          };
        });
        get().loadSessions();
        reconcileChatTaskOutbox(capturedTaskId, agentName, currentSessionKey, () => get().syncMessages());
      },
      (err: Error & { resolution?: ErrorResolutionAction; errorDetail?: string; providerId?: string }) => {
        set((state) => {
          const isCurrent = state.currentSessionKey === currentSessionKey;
          const applyError = (m: ChatMessage): ChatMessage => {
            if (m.id !== assistantId) return m;
            if (err.resolution) {
              return { ...m, error: err.message, errorDetail: err.errorDetail, resolution: err.resolution, providerId: err.providerId, loading: false };
            }
            return { ...m, error: presentChatRuntimeError(err.message), loading: false };
          };
          return {
            messages: isCurrent ? state.messages.map(applyError) : state.messages,
            sessionBuffers: clearBuffer(state.sessionBuffers, currentSessionKey),
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: failOperationInMap(state.operations, currentSessionKey, err.message),
          };
        });
        reconcileTopicsAfterTurn(currentSessionKey);
      },
    );

    set((state) => {
      const baseMessages = state.messages.map((m) => (
        m.id === replacedId ? { ...m, replacedBy: assistantMsg.id } : m
      )).concat(assistantMsg);
      return {
        messages: baseMessages,
        isStreaming: true,
        streamingStartedAt: startedAt,
        abortController: controller,
        operations: {
          ...state.operations,
          [currentSessionKey]: createOperation({ sessionKey: currentSessionKey, type: 'regenerate', assistantMessageId: assistantId, abortController: controller }),
        },
        sessionBuffers: { ...state.sessionBuffers, [currentSessionKey]: baseMessages },
      };
    });
  },

  retryMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;

    const prompt = findRegenerationPrompt(messages, messageId);
    if (!prompt) return;

    const { currentSessionKey } = get();
    const agentState = useAgentStore.getState();
    const { selectedAgent } = agentState;
    const agentName = selectedAgent || 'assistant';
    const execution = resolveAgentExecutionRef(agentName);
    if (!execution) {
      set({ readinessErrorKey: 'chat.agentReadiness.modelRequired' });
      return;
    }
    const { provider: effectiveProvider, model: effectiveModel, runtimeConfig } = execution;
    set({ readinessErrorKey: null });
    const replacedId = prompt.responseIds[prompt.responseIds.length - 1] || messageId;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      model: effectiveModel,
      operation: 'retry',
      replacementOf: replacedId,
    };

    const startedAt = Date.now();
    const assistantId = assistantMsg.id;
    let capturedTaskId = '';

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        currentSessionKey,
        agentName,
        prompt.userMsg.content,
        prompt.userMsg.attachments || [],
        effectiveProvider,
        effectiveModel,
        runtimeConfig,
      ),
      (event: StreamEvent) => {
        if (typeof event.data?.task_id === 'string') capturedTaskId = event.data.task_id;
        set((state) => {
          const operationEvent = applyOperationEventIdentity(
            state.operations,
            currentSessionKey,
            event,
          );
          if (!operationEvent.accepted) return state;
          const isCurrent = state.currentSessionKey === currentSessionKey;
          const applyTo = (list: ChatMessage[]): ChatMessage[] => {
            const idx = list.findIndex((m) => m.id === assistantId);
            if (idx === -1) return list;
            const next = [...list];
            next[idx] = applyStreamEvent(next[idx], event);
            return next;
          };
          const sessionBuffers = setBuffer(state.sessionBuffers, currentSessionKey, applyTo);
          if (!isCurrent) {
            return { sessionBuffers, operations: operationEvent.operations };
          }
          return {
            sessionBuffers,
            operations: operationEvent.operations,
            messages: applyTo(state.messages),
          };
        });
      },
      () => {
        set((state) => {
          const isCurrent = state.currentSessionKey === currentSessionKey;
          return {
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: clearOperation(state.operations, currentSessionKey),
            sessionBuffers: clearBuffer(state.sessionBuffers, currentSessionKey),
          };
        });
        get().loadSessions();
        reconcileChatTaskOutbox(capturedTaskId, agentName, currentSessionKey, () => get().syncMessages());
      },
      (err: Error & { resolution?: ErrorResolutionAction; errorDetail?: string; providerId?: string }) => {
        set((state) => {
          const isCurrent = state.currentSessionKey === currentSessionKey;
          const applyError = (m: ChatMessage): ChatMessage => (m.id === assistantId
            ? (err.resolution
              ? { ...m, error: err.message, errorDetail: err.errorDetail, resolution: err.resolution, providerId: err.providerId, loading: false }
              : { ...m, error: presentChatRuntimeError(err.message), loading: false })
            : m);
          return {
            messages: isCurrent ? state.messages.map(applyError) : state.messages,
            sessionBuffers: clearBuffer(state.sessionBuffers, currentSessionKey),
            isStreaming: isCurrent ? false : state.isStreaming,
            streamingStartedAt: isCurrent ? null : state.streamingStartedAt,
            abortController: isCurrent ? null : state.abortController,
            operations: failOperationInMap(state.operations, currentSessionKey, err.message),
          };
        });
        reconcileTopicsAfterTurn(currentSessionKey);
      },
    );

    set((state) => {
      const baseMessages = state.messages.map((m) => (
        m.id === replacedId ? { ...m, replacedBy: assistantMsg.id } : m
      )).concat(assistantMsg);
      return {
        messages: baseMessages,
        isStreaming: true,
        streamingStartedAt: startedAt,
        abortController: controller,
        operations: {
          ...state.operations,
          [currentSessionKey]: createOperation({ sessionKey: currentSessionKey, type: 'retry', assistantMessageId: assistantId, abortController: controller }),
        },
        sessionBuffers: { ...state.sessionBuffers, [currentSessionKey]: baseMessages },
      };
    });
  },

  deleteAndRegenerateMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;

    const prompt = findRegenerationPrompt(messages, messageId);
    if (!prompt) return;

    const toRemove = new Set(prompt.responseIds);
    set((state) => ({
      messages: state.messages.filter((m) => !toRemove.has(m.id)),
    }));

    await Promise.all([...toRemove]
      .filter((id) => !id.startsWith('temp-'))
      .map((id) => api.deleteMessage(id).catch((error) => {
        log.warn('chat', 'Failed to delete replaced message during regenerate', { id, error: String(error) });
      })));

    get().regenerateMessage(prompt.userMsg.id);
  },

  branchFromMessage: async (messageId: string) => {
    const { currentSessionKey, messages } = get();
    const sourceIndex = messages.findIndex((m) => m.id === messageId);
    if (sourceIndex === -1) return;

    try {
      const result = await api.duplicateSession(currentSessionKey);
      const conversationId = result.conversationId;
      const duplicatedMessages = await api.getMessages(conversationId);
      const source = messages[sourceIndex];
      const branchCutIndex = duplicatedMessages.findIndex((m) =>
        m.role === source.role
        && m.content === source.content
        && Math.abs(new Date(m.created_at).getTime() - source.timestamp) < 1000,
      );
      const deleteFrom = branchCutIndex >= 0 ? branchCutIndex + 1 : sourceIndex + 1;
      await Promise.all(duplicatedMessages.slice(deleteFrom).map((m) =>
        api.deleteMessage(m.id).catch((error) => {
          log.warn('chat', 'Failed to prune branched message', { id: m.id, error: String(error) });
        }),
      ));
      await get().loadSessions();
      await get().selectSession(conversationId);
      set((state) => ({
        messages: state.messages.map((m, index) => (
          index === Math.min(sourceIndex, state.messages.length - 1)
            ? { ...m, operation: 'branch' }
            : m
        )),
      }));
    } catch (error) {
      log.error('chat', 'Failed to branch conversation from message', { messageId, error: String(error) });
    }
  },

  decideToolApproval: async (approvalId: string, approved: boolean) => {
    set((state) => ({
      messages: state.messages.map((message) => ({
        ...message,
        toolCalls: message.toolCalls?.map((tool) => (
          tool.approvalId === approvalId
            ? {
              ...tool,
              pending: approved,
              status: approved ? 'approved' : 'denied',
              approvalActor: 'desktop-user',
              approvedAt: new Date().toISOString(),
            }
            : tool
        )),
      })),
    }));
    try {
      await api.decideAgentToolApproval({
        approval_id: approvalId,
        approved,
        actor: 'desktop-user',
      });
    } catch (error) {
      log.error('chat', 'Failed to submit tool approval decision', { approvalId, approved, error: String(error) });
      set((state) => ({
        messages: state.messages.map((message) => ({
          ...message,
          toolCalls: message.toolCalls?.map((tool) => (
            tool.approvalId === approvalId
              ? {
                ...tool,
                pending: true,
                status: 'approval_required',
                approvalActor: undefined,
                approvedAt: undefined,
              }
              : tool
          )),
        })),
      }));
      throw error;
    }
  },

  stopStreaming: () => {
    get().stopOperation(get().currentSessionKey);
  },

  stopOperation: (sessionKey: string) => {
    log.info('chat', 'Streaming stopped', { sessionKey });
    const op = get().operations[sessionKey];
    if (!op || !isActiveOperation(op)) return;
    const cancelled = cancelOperation(op);
    api.stopChat(sessionKey).catch(() => {});
    set((state) => {
      const isCurrent = state.currentSessionKey === sessionKey;
      const finalizeList = (list: ChatMessage[]): ChatMessage[] =>
        list.map((m) => (m.loading ? finalizeToolCalls({ ...m, loading: false }, 'cancelled') : m));
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
    const msg = get().messages.find((m) => m.id === id);
    if (!msg) return;
    set((s) => ({ messages: s.messages.filter((m) => m.id !== id) }));
    if (!id.startsWith('temp-')) {
      try { await api.deleteMessage(id); } catch { /* already removed from UI */ }
    }
  },

  editMessage: async (id: string, content: string) => {
    set((s) => ({
      messages: s.messages.map((m) => m.id === id ? { ...m, content } : m),
    }));
    if (!id.startsWith('temp-')) {
      try { await api.updateMessage(id, content); } catch { /* already updated in UI */ }
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
