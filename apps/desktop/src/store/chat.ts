import { create } from 'zustand';
import {
  api,
  streamChat,
  type Message,
  type Session,
  type StreamEvent,
  type ChatImageInput,
  type UploadResult,
  type AvailableModel,
  type Agent,
  type AgentChatConfig,
  type AgentParams,
  type AppletInfo,
  type NotebookDocument,
  parseAgentChatConfig,
  parseAgentParams,
} from '../services/desktop_api';

export interface ToolCallInfo {
  id: string;
  name: string;
  args?: string;
  result?: string;
  pending?: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  contentType?: 'text' | 'card';
  images?: string[];
  toolName?: string;
  toolCallId?: string;
  toolCalls?: ToolCallInfo[];
  loading?: boolean;
  timestamp: number;
  model?: string;
  error?: string;
}

export interface PendingImage {
  file: File;
  previewUrl: string;
  dataUrl?: string;
  servingUrl?: string;
  filename?: string;
  mimeType: string;
  uploading: boolean;
}

interface ChatState {
  sessions: Session[];
  currentSessionKey: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  abortController: AbortController | null;
  pendingImages: PendingImage[];

  // Toolbar state
  selectedModel: string;
  selectedAgent: string;
  availableModels: AvailableModel[];
  defaultModel: string;
  agents: Agent[];
  applets: AppletInfo[];
  enabledAppletIds: string[];

  // Portal / Notebook
  showPortal: boolean;
  portalDocuments: NotebookDocument[];
  portalLoading: boolean;

  // Wide screen
  wideScreen: boolean;

  loadSessions: () => Promise<void>;
  mergeSessions: (sessions: Session[]) => void;
  mergeSessionModel: (key: string, model: string, agentId: string) => void;
  selectSession: (key: string, sessionOverride?: Session) => Promise<void>;
  newSession: () => void;
  deleteSession: (key: string) => Promise<void>;
  sendMessage: (content: string) => void;
  regenerateMessage: (messageId: string) => void;
  stopStreaming: () => void;
  deleteMessage: (id: string) => Promise<void>;
  editMessage: (id: string, content: string) => Promise<void>;
  addImage: (file: File) => Promise<void>;
  removeImage: (index: number) => void;
  clearImages: () => void;

  // Toolbar actions
  setSelectedModel: (model: string) => void;
  setSelectedAgent: (agent: string) => void;
  loadModels: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadApplets: () => Promise<void>;
  toggleApplet: (id: string) => void;

  // Agent config persistence (params, chatConfig)
  updateAgentConfig: (agentName: string, updates: { chatConfig?: Partial<AgentChatConfig>; params?: Partial<AgentParams> }) => Promise<void>;
  getCurrentAgentChatConfig: () => AgentChatConfig;
  getCurrentAgentParams: () => AgentParams;

  // Sync messages from backend (replace temp IDs with real IDs)
  syncMessages: () => Promise<void>;

  // Save topic / new session
  saveCurrentTopic: () => Promise<void>;

  // Portal / Notebook
  togglePortal: () => void;
  loadDocuments: () => Promise<void>;
  createDocument: (title: string, content: string) => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;
  saveMessageToNotebook: (message: ChatMessage) => Promise<void>;

  // Wide screen
  setWideScreen: (wide: boolean) => void;
  loadPreferences: () => Promise<void>;
}

let messageCounter = 0;
function tempId() {
  return `temp-${Date.now()}-${messageCounter++}`;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionKey: 'main',
  messages: [],
  isStreaming: false,
  abortController: null,
  pendingImages: [],

  selectedModel: '',
  selectedAgent: 'assistant',
  availableModels: [],
  defaultModel: '',
  agents: [],
  applets: [],
  enabledAppletIds: [],

  showPortal: false,
  portalDocuments: [],
  portalLoading: false,

  wideScreen: false,

  loadSessions: async () => {
    try {
      const sessions = await api.listSessions();
      set({ sessions });
      const { currentSessionKey, selectedModel, defaultModel } = get();
      if (!selectedModel || selectedModel === defaultModel) {
        const current = sessions.find((s) => s.key === currentSessionKey);
        if (current?.model_override) {
          set({ selectedModel: current.model_override });
        }
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
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
    if (key === get().currentSessionKey) return;
    const session = sessionOverride ?? get().sessions.find((s) => s.key === key);
    const sessionModel = session?.model_override || '';
    const { availableModels, defaultModel } = get();
    const modelIds = new Set(availableModels.map((m) => m.id));
    let nextModel = sessionModel || defaultModel;
    if (nextModel && modelIds.size > 0 && !modelIds.has(nextModel)) {
      nextModel = '';
    }
    if (!nextModel && availableModels.length > 0) {
      nextModel = modelIds.has(defaultModel) ? defaultModel : availableModels[0].id;
    }
    set({
      currentSessionKey: key,
      messages: [],
      portalDocuments: [],
      pendingImages: [],
      selectedModel: nextModel,
    });
    try {
      const msgs = await api.getMessages(key);
      const raw: ChatMessage[] = msgs.map((m: Message) => {
        const msg: ChatMessage = {
          id: m.id,
          role: m.role as ChatMessage['role'],
          content: m.content,
          contentType: m.content_type || 'text',
          images: m.attachments
            ?.filter((a) => a.type === 'image')
            .map((a) => a.url),
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
      // Merge DB tool messages into the preceding assistant message's toolCalls
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
      set({ messages: chatMessages });
    } catch {
      set({ messages: [] });
    }
    if (get().showPortal) get().loadDocuments();
  },

  newSession: () => {
    const key = `session-${Date.now()}`;
    set({ currentSessionKey: key, messages: [], pendingImages: [], selectedModel: get().defaultModel });
  },

  deleteSession: async (key: string) => {
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
      console.error('Failed to delete session:', e);
    }
  },

  addImage: async (file: File) => {
    const previewUrl = URL.createObjectURL(file);
    const pending: PendingImage = {
      file,
      previewUrl,
      mimeType: file.type,
      uploading: true,
    };
    set((s) => ({ pendingImages: [...s.pendingImages, pending] }));

    try {
      const result: UploadResult = await api.uploadFile(file);
      set((s) => ({
        pendingImages: s.pendingImages.map((p) =>
          p.previewUrl === previewUrl
            ? { ...p, dataUrl: result.data_url, servingUrl: result.url, filename: result.filename, uploading: false }
            : p,
        ),
      }));
    } catch (err) {
      console.error('Upload failed:', err);
      set((s) => ({
        pendingImages: s.pendingImages.filter((p) => p.previewUrl !== previewUrl),
      }));
    }
  },

  removeImage: (index: number) => {
    set((s) => {
      const images = [...s.pendingImages];
      if (images[index]) {
        URL.revokeObjectURL(images[index].previewUrl);
        images.splice(index, 1);
      }
      return { pendingImages: images };
    });
  },

  clearImages: () => {
    const { pendingImages } = get();
    pendingImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    set({ pendingImages: [] });
  },

  setSelectedModel: (model: string) => {
    set({ selectedModel: model });
    const { currentSessionKey, selectedAgent } = get();
    api.setSessionModel(currentSessionKey, model).then(() => {
      // Update local session so model persists when switching topics
      get().mergeSessionModel(currentSessionKey, model, selectedAgent || 'assistant');
    }).catch(() => {});
  },
  setSelectedAgent: (agent: string) => set({ selectedAgent: agent }),

  loadModels: async () => {
    try {
      const res = await api.listAvailableModels();
      const models = res.models || [];
      const modelIds = new Set(models.map((m) => m.id));
      const preferredDefault = res.default && modelIds.has(res.default) ? res.default : '';
      const currentSelected = get().selectedModel;
      const nextSelected =
        (currentSelected && modelIds.has(currentSelected) && currentSelected) ||
        preferredDefault ||
        models[0]?.id ||
        '';
      set({
        availableModels: models,
        defaultModel: preferredDefault || models[0]?.id || '',
        selectedModel: nextSelected,
      });
    } catch {
      // keep empty
    }
  },

  loadAgents: async () => {
    try {
      const agents = await api.listAgents();
      set({ agents });
      const current = agents.find((a) => a.name === get().selectedAgent);
      if (current?.model && !get().selectedModel) {
        set({ selectedModel: current.model });
      }
    } catch {
      // keep empty
    }
  },

  loadApplets: async () => {
    try {
      const [applets, prefs] = await Promise.all([
        api.listApplets(),
        api.getPreferences(),
      ]);
      const activeIds = applets.filter((a) => a.status === 'active').map((a) => a.manifest.id);
      if (prefs.web_search_enabled && !activeIds.includes('web-search')) {
        activeIds.push('web-search');
      } else if (prefs.web_search_enabled === false) {
        const idx = activeIds.indexOf('web-search');
        if (idx >= 0) activeIds.splice(idx, 1);
      }
      set({ applets, enabledAppletIds: activeIds });
    } catch {
      // keep empty
    }
  },

  toggleApplet: (id: string) => {
    set((s) => {
      const enabled = s.enabledAppletIds.includes(id);
      const newIds = enabled
        ? s.enabledAppletIds.filter((x) => x !== id)
        : [...s.enabledAppletIds, id];

      if (id === 'web-search') {
        api.setPreferences({ web_search_enabled: !enabled }).catch(() => {});
      }

      return { enabledAppletIds: newIds };
    });
  },

  updateAgentConfig: async (agentName: string, updates: { chatConfig?: Partial<AgentChatConfig>; params?: Partial<AgentParams> }) => {
    const { agents } = get();
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) return;

    const payload: Record<string, string> = {};

    if (updates.chatConfig) {
      const existing = parseAgentChatConfig(agent);
      const merged = { ...existing, ...updates.chatConfig };
      payload.chatConfig = JSON.stringify(merged);
    }
    if (updates.params) {
      const existing = parseAgentParams(agent);
      const merged = { ...existing, ...updates.params };
      payload.params = JSON.stringify(merged);
    }

    try {
      const updated = await api.updateAgent(agent.id, payload);
      set((s) => ({
        agents: s.agents.map((a) => (a.id === updated.id ? updated : a)),
      }));
    } catch (e) {
      console.error('Failed to update agent config:', e);
    }
  },

  getCurrentAgentChatConfig: () => {
    const { agents, selectedAgent } = get();
    const agent = agents.find((a) => a.name === selectedAgent);
    if (!agent) return {};
    return parseAgentChatConfig(agent);
  },

  getCurrentAgentParams: () => {
    const { agents, selectedAgent } = get();
    const agent = agents.find((a) => a.name === selectedAgent);
    if (!agent) return {};
    return parseAgentParams(agent);
  },

  syncMessages: async () => {
    const { currentSessionKey, messages: currentMessages } = get();

    const errorMap = new Map<string, string>();
    for (const m of currentMessages) {
      if (m.error) {
        errorMap.set(m.id, m.error);
      }
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

      // Preserve error states from the current session that aren't in server data.
      // If the last current message has an error and the server didn't return a
      // corresponding assistant message, keep it so the user sees the error.
      if (errorMap.size > 0) {
        const lastCurrent = currentMessages[currentMessages.length - 1];
        if (lastCurrent?.error && lastCurrent.role === 'assistant') {
          const serverHasIt = chatMessages.some(
            (m) => m.role === 'assistant' && m.id === lastCurrent.id,
          );
          if (!serverHasIt) {
            chatMessages.push({
              ...lastCurrent,
              loading: false,
            });
          }
        }
      }

      set({ messages: chatMessages });
    } catch {
      // keep current messages if sync fails
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
    console.log(`Saved topic "${title}" from ${currentSessionKey}, switched to ${newKey}`);
  },

  sendMessage: (content: string) => {
    const { currentSessionKey, pendingImages, selectedAgent, selectedModel, defaultModel } = get();

    const readyImages = pendingImages.filter((p) => !p.uploading && p.dataUrl);
    const imageUrls = readyImages.map((p) => p.servingUrl || p.previewUrl);

    const chatImages: ChatImageInput[] = readyImages.map((p) => ({
      data_url: p.dataUrl!,
      mime_type: p.mimeType,
      url: p.servingUrl,
      filename: p.filename,
    }));

    const userMsg: ChatMessage = {
      id: tempId(),
      role: 'user',
      content,
      images: imageUrls.length > 0 ? imageUrls : undefined,
      timestamp: Date.now(),
    };

    pendingImages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    set({ pendingImages: [] });

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

    const controller = streamChat(
      content,
      currentSessionKey,
      selectedAgent || 'assistant',
      (event: StreamEvent) => {
        set((state) => {
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          if (idx === -1) return state;

          switch (event.event) {
            case 'text':
              msgs[idx] = {
                ...msgs[idx],
                content: msgs[idx].content + (event.data.content || ''),
                loading: true,
              };
              break;
            case 'tool_call': {
              const existing = msgs[idx].toolCalls || [];
              msgs[idx] = {
                ...msgs[idx],
                toolCalls: [...existing, {
                  id: event.data.id || tempId(),
                  name: event.data.name,
                  args: event.data.args,
                  pending: true,
                }],
              };
              break;
            }
            case 'tool_result': {
              const calls = (msgs[idx].toolCalls || []).map((tc) =>
                tc.name === event.data.name && tc.pending
                  ? { ...tc, result: event.data.content, pending: false }
                  : tc,
              );
              msgs[idx] = { ...msgs[idx], toolCalls: calls };
              break;
            }
            case 'image': {
              const imgs = msgs[idx].images || [];
              msgs[idx] = { ...msgs[idx], images: [...imgs, event.data.url] };
              break;
            }
            case 'error':
              msgs[idx] = {
                ...msgs[idx],
                error: event.data.error,
                loading: false,
              };
              break;
            case 'done':
              if (event.data.model) {
                msgs[idx] = { ...msgs[idx], model: event.data.model };
              }
              break;
          }
          return { messages: msgs };
        });
      },
      () => {
        set({ isStreaming: false, abortController: null });
        get().syncMessages();
        get().loadSessions();
      },
      (err: Error) => {
        set((state) => {
          const msgs = state.messages.map((m) =>
            m.id === assistantId
              ? { ...m, error: err.message, loading: false }
              : m,
          );
          return { messages: msgs, isStreaming: false, abortController: null };
        });
      },
      chatImages.length > 0 ? chatImages : undefined,
      modelOverride,
    );

    set({ abortController: controller });
  },

  regenerateMessage: async (messageId: string) => {
    const { messages, isStreaming } = get();
    if (isStreaming) return;

    const msgIndex = messages.findIndex((m) => m.id === messageId);
    if (msgIndex === -1) return;

    const msg = messages[msgIndex];
    let userMsg: ChatMessage | undefined;
    const toRemove = new Set<string>();

    if (msg.role === 'assistant') {
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          userMsg = messages[i];
          break;
        }
      }
      if (!userMsg) return;
      const userIdx = messages.indexOf(userMsg);
      for (let i = userIdx + 1; i <= msgIndex; i++) {
        if (messages[i].role !== 'user') toRemove.add(messages[i].id);
      }
    } else if (msg.role === 'user') {
      userMsg = msg;
      for (let i = msgIndex + 1; i < messages.length; i++) {
        if (messages[i].role === 'user') break;
        toRemove.add(messages[i].id);
      }
    }

    if (!userMsg) return;

    set((state) => ({
      messages: state.messages.filter((m) => !toRemove.has(m.id)),
    }));

    const deletePromises = [...toRemove]
      .filter((id) => !id.startsWith('temp-'))
      .map((id) => api.deleteMessage(id).catch(() => {}));
    await Promise.all(deletePromises);

    const { currentSessionKey, selectedAgent, selectedModel, defaultModel } = get();
    const modelOverride = selectedModel && selectedModel !== defaultModel ? selectedModel : undefined;

    const assistantMsg: ChatMessage = {
      id: tempId(),
      role: 'assistant',
      content: '',
      loading: true,
      timestamp: Date.now(),
    };

    set((state) => ({
      messages: [...state.messages, assistantMsg],
      isStreaming: true,
    }));

    const assistantId = assistantMsg.id;

    const controller = streamChat(
      userMsg.content,
      currentSessionKey,
      selectedAgent || 'assistant',
      (event: StreamEvent) => {
        set((state) => {
          const msgs = [...state.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          if (idx === -1) return state;

          switch (event.event) {
            case 'text':
              msgs[idx] = { ...msgs[idx], content: msgs[idx].content + (event.data.content || ''), loading: true };
              break;
            case 'tool_call': {
              const existing = msgs[idx].toolCalls || [];
              msgs[idx] = {
                ...msgs[idx],
                toolCalls: [...existing, {
                  id: event.data.id || tempId(),
                  name: event.data.name,
                  args: event.data.args,
                  pending: true,
                }],
              };
              break;
            }
            case 'tool_result': {
              const calls = (msgs[idx].toolCalls || []).map((tc) =>
                tc.name === event.data.name && tc.pending
                  ? { ...tc, result: event.data.content, pending: false }
                  : tc,
              );
              msgs[idx] = { ...msgs[idx], toolCalls: calls };
              break;
            }
            case 'image': {
              const imgs2 = msgs[idx].images || [];
              msgs[idx] = { ...msgs[idx], images: [...imgs2, event.data.url] };
              break;
            }
            case 'error':
              msgs[idx] = { ...msgs[idx], error: event.data.error, loading: false };
              break;
          }
          return { messages: msgs };
        });
      },
      () => {
        set({ isStreaming: false, abortController: null });
        get().syncMessages();
      },
      (err: Error) => {
        set((state) => ({
          messages: state.messages.map((m) => m.id === assistantId ? { ...m, error: err.message, loading: false } : m),
          isStreaming: false, abortController: null,
        }));
      },
      userMsg.images?.map((url) => ({ data_url: url, mime_type: 'image/png' })),
      modelOverride,
    );

    set({ abortController: controller });
  },

  stopStreaming: () => {
    const { abortController, currentSessionKey } = get();
    if (abortController) {
      abortController.abort();
      api.stopChat(currentSessionKey).catch(() => {});
      set((state) => ({
        messages: state.messages.map((m) => m.loading ? { ...m, loading: false } : m),
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

  togglePortal: () => {
    const next = !get().showPortal;
    set({ showPortal: next });
    if (next) get().loadDocuments();
  },

  loadDocuments: async () => {
    const { currentSessionKey } = get();
    set({ portalLoading: true });
    try {
      const docs = await api.listDocuments(currentSessionKey);
      set({ portalDocuments: docs, portalLoading: false });
    } catch {
      set({ portalDocuments: [], portalLoading: false });
    }
  },

  createDocument: async (title: string, content: string) => {
    const { currentSessionKey } = get();
    try {
      await api.createDocument(currentSessionKey, title, content);
      get().loadDocuments();
    } catch (e) {
      console.error('Failed to create document:', e);
    }
  },

  deleteDocument: async (id: string) => {
    try {
      await api.deleteDocument(id);
      set((s) => ({ portalDocuments: s.portalDocuments.filter((d) => d.id !== id) }));
    } catch (e) {
      console.error('Failed to delete document:', e);
    }
  },

  saveMessageToNotebook: async (message: ChatMessage) => {
    const { currentSessionKey } = get();
    const title = message.content.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80) || 'Saved from chat';
    let content = message.content;
    if (message.toolCalls && message.toolCalls.length > 0) {
      const toolText = message.toolCalls
        .map((tc) => {
          let s = `\n---\n**Tool: ${tc.name}**`;
          if (tc.args) s += `\nArguments: \`${tc.args}\``;
          if (tc.result) s += `\nResult:\n${tc.result}`;
          return s;
        })
        .join('\n');
      content = toolText + '\n\n' + content;
    }
    try {
      await api.createDocument(currentSessionKey, title, content, 'note');
      get().loadDocuments();
    } catch (e) {
      console.error('Failed to save to notebook:', e);
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
