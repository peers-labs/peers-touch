import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import i18n, { resolveI18nValue } from '../i18n/index';
import {
  api,
  streamAgentCollaborationEvents,
  type Message,
  type MessageAttachment,
  type Session,
  type StreamEvent,
  type ChatAttachmentInput,
  type AgentExecuteTurnKnowledgeResource,
} from '../services/desktop_api';
import { agentService } from '../services/agent-service';
import { buildAgentRuntimeConfig } from '../services/agent-runtime-config';
import { useAgentStore } from './agent';
import { useAgentTopicStore } from './agentTopics';

export { useAgentStore } from './agent';

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
  thinking?: string;
  thinkingDone?: boolean;
  processDuration?: number;
  lastEventAt?: number;
  operation?: 'regenerate' | 'retry' | 'branch';
  replacementOf?: string;
  replacedBy?: string;
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

interface ChatState {
  sessions: Session[];
  currentSessionKey: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  abortController: AbortController | null;


  wideScreen: boolean;

  loadSessions: () => Promise<void>;
  mergeSessions: (sessions: Session[]) => void;
  mergeSessionModel: (key: string, model: string, agentId: string) => void;
  selectSession: (key: string, sessionOverride?: Session) => Promise<void>;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  sendMessage: (content: string, attachments?: ChatComposerAttachment[]) => void;
  regenerateMessage: (messageId: string) => void;
  retryMessage: (messageId: string) => void;
  deleteAndRegenerateMessage: (messageId: string) => void;
  branchFromMessage: (messageId: string) => Promise<void>;
  decideToolApproval: (approvalId: string, approved: boolean) => Promise<void>;
  stopStreaming: () => void;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;

  syncMessages: () => Promise<void>;
  saveCurrentTopic: () => Promise<void>;


  setWideScreen: (wide: boolean) => void;
  loadPreferences: () => Promise<void>;
}

let messageCounter = 0;
function tempId() {
  return `temp-${Date.now()}-${messageCounter++}`;
}

function presentChatRuntimeError(message: string): string {
  if (/unknown command|agent_execute_turn_stream|chat_completion_stream|Failed to execute agent turn|no credentials|credential|provider/i.test(message)) {
    return i18n.t("chat.runtime.unavailable", { ns: "chat", defaultValue: "The selected runtime is not ready. Check model credentials and try again." });
  }
  return message;
}

export function applyStreamEvent(msg: ChatMessage, event: StreamEvent): ChatMessage {
  switch (event.event) {
    case 'text':
      return { ...msg, content: msg.content + (event.data.content || ''), loading: true, lastEventAt: Date.now() };

    case 'tool_call': {
      const existing = msg.toolCalls || [];
      return {
        ...msg,
        toolCalls: [...existing, {
          id: event.data.id || tempId(),
          name: event.data.name,
          args: event.data.args,
          pending: true,
          status: 'pending' as ToolCallStatus,
        }],
        lastEventAt: Date.now(),
      };
    }

    case 'tool_result': {
      const delegationResults = event.data.name === 'delegate_task'
        ? parseDelegationResults(event.data.content || event.data.result || '')
        : [];
      const calls = (msg.toolCalls || []).map((tc) =>
        (tc.id === event.data.id || tc.name === event.data.name) && tc.pending
          ? {
            ...tc,
            result: event.data.content,
            pending: false,
            status: 'success' as ToolCallStatus,
            delegationResults: delegationResults.length > 0 ? delegationResults : tc.delegationResults,
          }
          : tc,
      );
      return {
        ...msg,
        toolCalls: calls,
        delegationResults: delegationResults.length > 0 ? delegationResults : msg.delegationResults,
        lastEventAt: Date.now(),
      };
    }

    case 'tool_approval_required': {
      const existing = msg.toolCalls || [];
      const approvalId = event.data.approvalId || event.data.id || tempId();
      const nextCall: ToolCallInfo = {
        id: event.data.id || event.data.toolCallId || approvalId,
        name: event.data.name || event.data.toolName || 'local_mcp',
        args: event.data.args || event.data.arguments,
        pending: true,
        status: 'approval_required',
        approvalId,
        serverName: event.data.serverName,
        source: event.data.source,
      };
      const replaced = existing.some((tc) => tc.id === nextCall.id || tc.approvalId === approvalId);
      return {
        ...msg,
        toolCalls: replaced
          ? existing.map((tc) => (tc.id === nextCall.id || tc.approvalId === approvalId ? { ...tc, ...nextCall } : tc))
          : [...existing, nextCall],
        lastEventAt: Date.now(),
      };
    }

    case 'tool_approval_decision': {
      const approved = event.data.approved === 'true' || event.data.approved === '1';
      const calls = (msg.toolCalls || []).map((tc) =>
        tc.approvalId === event.data.approvalId || tc.id === event.data.id
          ? {
            ...tc,
            pending: approved,
            status: approved ? 'approved' as ToolCallStatus : 'denied' as ToolCallStatus,
            approvalActor: event.data.actor,
            approvedAt: event.data.decidedAt,
          }
          : tc,
      );
      return { ...msg, toolCalls: calls, lastEventAt: Date.now() };
    }

    case 'image': {
      const imgs = msg.images || [];
      return { ...msg, images: [...imgs, event.data.url] };
    }

    case 'thinking':
      return {
        ...msg,
        thinking: (msg.thinking || '') + (event.data.content || ''),
        thinkingDone: !!event.data.done,
        lastEventAt: Date.now(),
      };

    case 'progress': {
      if (event.data.stage === 'knowledge_retrieved' && event.data.result) {
        return {
          ...msg,
          knowledgeChunks: parseKnowledgeChunks(event.data.result),
          lastEventAt: Date.now(),
        };
      }
      const progCalls = (msg.toolCalls || []).map((tc) =>
        tc.pending
          ? { ...tc, progress: event.data.message || tc.progress, progressPct: event.data.pct != null ? Number(event.data.pct) : tc.progressPct }
          : tc,
      );
      return { ...msg, toolCalls: progCalls, lastEventAt: Date.now() };
    }

    case 'error': {
      log.error('chat', 'Stream error', { event: event.data });
      const errCalls = (msg.toolCalls || []).map((tc) =>
        tc.pending ? { ...tc, result: `Error: ${event.data.error || 'Unknown'}`, pending: false, status: 'error' as ToolCallStatus } : tc,
      );
      return { ...msg, toolCalls: errCalls, error: event.data.error, loading: false };
    }

    case 'done': {
      const doneCalls = (msg.toolCalls || []).map((tc) =>
        tc.pending ? { ...tc, pending: false, status: 'success' as ToolCallStatus } : tc,
      );
      return {
        ...msg,
        toolCalls: doneCalls,
        loading: false,
        model: event.data.model || msg.model,
        processDuration: Math.round((Date.now() - msg.timestamp) / 1000),
      };
    }

    default:
      return msg;
  }
}

function parseKnowledgeChunks(value: string): KnowledgeChunkInfo[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => ({
      chunkId: String(item.ChunkID || item.chunkId || ''),
      resourceId: String(item.ResourceID || item.resourceId || ''),
      resourceTitle: String(item.ResourceTitle || item.resourceTitle || ''),
      source: String(item.Source || item.source || ''),
      chunkIndex: Number(item.ChunkIndex ?? item.chunkIndex ?? 0),
      score: Number(item.Score ?? item.score ?? 0),
      contentPreview: String(item.ContentPreview || item.contentPreview || ''),
    })).filter((item) => item.chunkId && item.resourceId);
  } catch {
    return [];
  }
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

function messageAttachmentToComposerAttachment(attachment: MessageAttachment): ChatComposerAttachment {
  return {
    cid: attachment.url || attachment.filename || tempId(),
    filename: attachment.filename || attachment.url || '',
    mime_type: attachment.mime_type || 'application/octet-stream',
    size: 0,
    url: attachment.url,
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
  };
}

function getAgentRuntimeConfig(agentName: string): {
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
} {
  const agent = useAgentStore.getState().agents.find((item) => item.name === agentName);
  return buildAgentRuntimeConfig(agent);
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

export const useChatStore = createDesktopStore<ChatState>('chat', (set, get) => ({
  sessions: [],
  currentSessionKey: 'main',
  messages: [],
  isStreaming: false,
  abortController: null,


  wideScreen: false,

  loadSessions: async () => {
    log.info('chat', 'Loading sessions');
    try {
      const raw = await api.listSessions();
      const sessions = raw.map((s) => ({
        ...s,
        title: resolveI18nValue(s.title),
      }));
      log.info('chat', 'Sessions loaded', { count: sessions.length });
      set({ sessions });
      const { currentSessionKey } = get();
      const { selectedModel, defaultModel } = useAgentStore.getState();
      if (!selectedModel || selectedModel === defaultModel) {
        const current = sessions.find((s) => s.key === currentSessionKey);
        if (current?.model_override) {
          useAgentStore.getState().setSelectedModel(current.model_override);
        }
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

  selectSession: async (key: string, sessionOverride?: Session) => {
    log.info('chat', 'Selecting session', { key });
    if (key === get().currentSessionKey) return;
    const session = sessionOverride ?? get().sessions.find((s) => s.key === key);
    const sessionModel = session?.model_override || '';
    const { availableModels, defaultModel } = useAgentStore.getState();
    const modelIds = new Set(availableModels.map((m) => m.id));
    let nextModel = sessionModel || defaultModel;
    if (nextModel && modelIds.size > 0 && !modelIds.has(nextModel)) {
      nextModel = '';
    }
    if (!nextModel && availableModels.length > 0) {
      nextModel = modelIds.has(defaultModel) ? defaultModel : availableModels[0].id;
    }
    useAgentStore.getState().setSelectedModel(nextModel);
    set({
      currentSessionKey: key,
      messages: [],
    });
    try {
      const msgs = await api.getMessages(key);
      if (get().currentSessionKey !== key) return;
      const raw: ChatMessage[] = msgs.map((m: Message) => {
        const msg: ChatMessage = {
          id: m.id,
          role: m.role as ChatMessage['role'],
          content: m.content,
          contentType: m.content_type || 'text',
          images: m.attachments
            ?.filter((a) => a.type === 'image')
            .map((a) => a.url),
          attachments: m.attachments?.map(messageAttachmentToComposerAttachment),
          timestamp: new Date(m.created_at).getTime(),
          model: m.model,
        };
        if (m.role === 'assistant' && m.tool_calls) {
          try {
            const parsed = JSON.parse(m.tool_calls) as Array<{ id?: string; name?: string; args?: string; result?: string }>;
            msg.toolCalls = parsed.map((tc) => ({
              id: tc.id || tc.name || '',
              name: tc.name || 'tool',
              args: tc.args,
              result: tc.result,
              pending: false,
            }));
          } catch {
            /* ignore parse error */
          }
        }
        return msg;
      });
      const chatMessages: ChatMessage[] = [];
      for (const m of raw) {
        if (m.role === 'tool' && chatMessages.length > 0) {
          const prev = chatMessages[chatMessages.length - 1];
          if (prev.role === 'assistant') {
            const nameMatch = m.content.match(/\*\*(\w+)\*\*/);
            const existing = prev.toolCalls || [];
            prev.toolCalls = [...existing, {
              id: m.id,
              name: nameMatch?.[1] || 'tool',
              result: m.content,
              pending: false,
            }];
            continue;
          }
        }
        chatMessages.push(m);
      }
      if (get().currentSessionKey !== key) return;
      set({ messages: chatMessages });
    } catch {
      if (get().currentSessionKey === key) set({ messages: [] });
    }
  },

  newSession: () => {
    const key = `session-${Date.now()}`;
    log.info('chat', 'New session created', { key });
    const { defaultModel } = useAgentStore.getState();
    useAgentStore.getState().setSelectedModel(defaultModel);
    set({ currentSessionKey: key, messages: [] });
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

    const cotFields = (m: ChatMessage) => ({
      toolCalls: m.toolCalls,
      thinking: m.thinking,
      thinkingDone: m.thinkingDone,
      processDuration: m.processDuration,
      lastEventAt: m.lastEventAt,
      error: m.error,
      images: m.images,
      attachments: m.attachments,
      operation: m.operation,
      replacementOf: m.replacementOf,
      replacedBy: m.replacedBy,
    });

    const existingById = new Map<string, ChatMessage>();
    const existingByIdx = new Map<number, ChatMessage>();
    for (const [i, m] of currentMessages.entries()) {
      existingById.set(m.id, m);
      existingByIdx.set(i, m);
    }

    try {
      const msgs = await api.getMessages(currentSessionKey);
      const raw: ChatMessage[] = msgs.map((m: Message) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        contentType: m.content_type || 'text',
        images: m.attachments
          ?.filter((a) => a.type === 'image')
          .map((a) => a.url),
        attachments: m.attachments?.map(messageAttachmentToComposerAttachment),
        timestamp: new Date(m.created_at).getTime(),
        model: m.model,
      }));
      const chatMessages: ChatMessage[] = [];
      for (const m of raw) {
        if (m.role === 'tool' && chatMessages.length > 0) {
          const prev = chatMessages[chatMessages.length - 1];
          if (prev.role === 'assistant') {
            const nameMatch = m.content.match(/\*\*(\w+)\*\*/);
            const existing = prev.toolCalls || [];
            prev.toolCalls = [...existing, {
              id: m.id,
              name: nameMatch?.[1] || 'tool',
              result: m.content,
              pending: false,
            }];
            continue;
          }
        }
        chatMessages.push(m);
      }

      const merged = chatMessages.map((serverMsg, i) => {
        const mem = existingById.get(serverMsg.id)
          || (existingByIdx.get(i)?.role === serverMsg.role ? existingByIdx.get(i) : undefined);
        if (mem) {
          const cot = cotFields(mem);
          const hasCOT = cot.toolCalls || cot.thinking || cot.processDuration != null || cot.attachments?.length;
          if (hasCOT) return { ...serverMsg, ...cot };
        }
        return serverMsg;
      });

      const lastCurrent = currentMessages[currentMessages.length - 1];
      if (lastCurrent?.error && lastCurrent.role === 'assistant') {
        const serverHasIt = merged.some((m) => m.id === lastCurrent.id);
        if (!serverHasIt) {
          merged.push({ ...lastCurrent, loading: false });
        }
      }

      set({ messages: merged });
    } catch {
    }
  },

  saveCurrentTopic: async () => {
    const { currentSessionKey, messages } = get();
    if (messages.length === 0) return;

    const firstUserMsg = messages.find((m) => m.role === 'user');
    const title = firstUserMsg?.content.slice(0, 40) || 'New topic';

    const newKey = `session-${Date.now()}`;
    set({ currentSessionKey: newKey, messages: [] });
    get().loadSessions();
    log.info('chat', `Saved topic "${title}" from ${currentSessionKey}, switched to ${newKey}`);
  },

  sendMessage: (content: string, attachments: ChatComposerAttachment[] = []) => {
    log.info('chat', 'Sending message', { sessionKey: get().currentSessionKey, contentLength: content.length });
    const { currentSessionKey } = get();
    const { selectedAgent, selectedModel, selectedProviderId, defaultModel } = useAgentStore.getState();
    const agentName = selectedAgent || 'assistant';
    const runtimeConfig = getAgentRuntimeConfig(agentName);

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

    const modelOverride = selectedModel && selectedModel !== defaultModel ? selectedModel : undefined;
    const usedModel = modelOverride || selectedModel || defaultModel;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      model: usedModel || undefined,
    };

    set((state) => ({
      messages: [...state.messages, userMsg, assistantMsg],
      isStreaming: true,
    }));

    const assistantId = assistantMsg.id;
    let capturedTaskId = '';

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        currentSessionKey,
        agentName,
        content,
        attachments,
        selectedProviderId,
        modelOverride,
        runtimeConfig,
      ),
      (event: StreamEvent) => {
        if (event.data?.task_id) capturedTaskId = event.data.task_id;
        set((state) => {
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          if (idx === -1) return state;
          msgs[idx] = applyStreamEvent(msgs[idx], event);
          return { messages: msgs };
        });
      },
      () => {
        log.info('chat', 'Stream complete');
        set({ isStreaming: false, abortController: null });
        get().loadSessions();
        reconcileChatTaskOutbox(capturedTaskId, agentName, currentSessionKey, () => get().syncMessages());
      },
      (err: Error) => {
        log.error('chat', 'Send message failed', { error: err.message });
        set((state) => {
          const msgs = state.messages.map((m) =>
            m.id === assistantId
              ? { ...m, error: presentChatRuntimeError(err.message), loading: false }
              : m,
          );
          return { messages: msgs, isStreaming: false, abortController: null };
        });
        reconcileTopicsAfterTurn(currentSessionKey);
      },
    );

    set({ abortController: controller });
  },

  regenerateMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;

    const prompt = findRegenerationPrompt(messages, messageId);
    if (!prompt) return;

    const { currentSessionKey } = get();
    const { selectedAgent, selectedModel, selectedProviderId, defaultModel } = useAgentStore.getState();
    const agentName = selectedAgent || 'assistant';
    const runtimeConfig = getAgentRuntimeConfig(agentName);
    const modelOverride = selectedModel && selectedModel !== defaultModel ? selectedModel : undefined;
    const replacedId = prompt.responseIds[prompt.responseIds.length - 1] || messageId;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      model: modelOverride || selectedModel || defaultModel || undefined,
      operation: 'regenerate',
      replacementOf: replacedId,
    };

    set((state) => ({
      messages: state.messages.map((m) => (
        m.id === replacedId ? { ...m, replacedBy: assistantMsg.id } : m
      )).concat(assistantMsg),
      isStreaming: true,
    }));

    const assistantId = assistantMsg.id;
    let capturedTaskId = '';

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        currentSessionKey,
        agentName,
        prompt.userMsg.content,
        prompt.userMsg.attachments || [],
        selectedProviderId,
        modelOverride,
        runtimeConfig,
      ),
      (event: StreamEvent) => {
        if (event.data?.task_id) capturedTaskId = event.data.task_id;
        set((state) => {
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          if (idx === -1) return state;
          msgs[idx] = applyStreamEvent(msgs[idx], event);
          return { messages: msgs };
        });
      },
      () => {
        set({ isStreaming: false, abortController: null });
        get().loadSessions();
        reconcileChatTaskOutbox(capturedTaskId, agentName, currentSessionKey, () => get().syncMessages());
      },
      (err: Error) => {
        set((state) => ({
          messages: state.messages.map((m) => m.id === assistantId ? { ...m, error: presentChatRuntimeError(err.message), loading: false } : m),
          isStreaming: false, abortController: null,
        }));
        reconcileTopicsAfterTurn(currentSessionKey);
      },
    );

    set({ abortController: controller });
  },

  retryMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;

    const prompt = findRegenerationPrompt(messages, messageId);
    if (!prompt) return;

    const { currentSessionKey } = get();
    const { selectedAgent, selectedModel, selectedProviderId, defaultModel } = useAgentStore.getState();
    const agentName = selectedAgent || 'assistant';
    const runtimeConfig = getAgentRuntimeConfig(agentName);
    const modelOverride = selectedModel && selectedModel !== defaultModel ? selectedModel : undefined;
    const replacedId = prompt.responseIds[prompt.responseIds.length - 1] || messageId;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
      model: modelOverride || selectedModel || defaultModel || undefined,
      operation: 'retry',
      replacementOf: replacedId,
    };

    set((state) => ({
      messages: state.messages.map((m) => (
        m.id === replacedId ? { ...m, replacedBy: assistantMsg.id } : m
      )).concat(assistantMsg),
      isStreaming: true,
    }));

    const assistantId = assistantMsg.id;
    let capturedTaskId = '';

    const controller = agentService.streamTurn(
      buildAgentTurnInput(
        currentSessionKey,
        agentName,
        prompt.userMsg.content,
        prompt.userMsg.attachments || [],
        selectedProviderId,
        modelOverride,
        runtimeConfig,
      ),
      (event: StreamEvent) => {
        if (event.data?.task_id) capturedTaskId = event.data.task_id;
        set((state) => {
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          if (idx === -1) return state;
          msgs[idx] = applyStreamEvent(msgs[idx], event);
          return { messages: msgs };
        });
      },
      () => {
        set({ isStreaming: false, abortController: null });
        get().loadSessions();
        reconcileChatTaskOutbox(capturedTaskId, agentName, currentSessionKey, () => get().syncMessages());
      },
      (err: Error) => {
        set((state) => ({
          messages: state.messages.map((m) => m.id === assistantId ? { ...m, error: presentChatRuntimeError(err.message), loading: false } : m),
          isStreaming: false,
          abortController: null,
        }));
        reconcileTopicsAfterTurn(currentSessionKey);
      },
    );

    set({ abortController: controller });
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
    log.info('chat', 'Streaming stopped');
    const { abortController, currentSessionKey } = get();
    if (abortController) {
      abortController.abort();
      api.stopChat(currentSessionKey).catch(() => {});
      set((state) => ({
        messages: state.messages.map((m) => m.loading ? finalizeToolCalls({ ...m, loading: false }, 'cancelled') : m),
        isStreaming: false,
        abortController: null,
      }));
    }
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


  setWideScreen: (wide: boolean) => {
    set({ wideScreen: wide });
    api.setPreferences({ wide_screen: wide }).catch(() => {});
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
