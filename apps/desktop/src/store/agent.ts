import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { resolveI18nValue } from '../i18n/index';
import {
  api,
  type AvailableModel,
  type Agent,
  type AgentChatConfig,
  type AppletInfo,
  parseAgentChatConfig,
} from '../services/desktop_api';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';

type AgentSurface = 'chat' | 'profile';

interface AgentState extends RevalidationState {
  selectedModel: string;
  selectedProviderId: string;
  selectedAgent: string;
  defaultAgent: string;
  availableModels: AvailableModel[];
  defaultModel: string;
  agents: Agent[];
  applets: AppletInfo[];
  enabledAppletIds: string[];
  agentSurfaces: Record<string, AgentSurface>;
  agentRosterOpen: boolean;

  setSelectedModel: (model: string, providerId?: string) => void;
  setSelectedAgent: (agent: string) => void;
  setAgentSurface: (agent: string, surface: AgentSurface) => void;
  getAgentSurface: (agent: string) => AgentSurface;
  setAgentRosterOpen: (open: boolean) => void;
  setDefaultAgent: (agentId: string) => Promise<void>;
  loadModels: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadApplets: () => Promise<void>;
  toggleApplet: (id: string) => Promise<void>;
  updateAgentConfig: (agentName: string, updates: { chatConfig?: Partial<AgentChatConfig> }) => Promise<void>;
  getCurrentAgentChatConfig: () => AgentChatConfig;
}

export const useAgentStore = createDesktopStore<AgentState>('agent', (set, get) => ({
  selectedModel: '',
  selectedProviderId: '',
  selectedAgent: 'assistant',
  defaultAgent: 'assistant',
  availableModels: [],
  defaultModel: '',
  agents: [],
  applets: [],
  enabledAppletIds: [],
  agentSurfaces: {},
  agentRosterOpen: true,
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  setSelectedModel: (model: string, providerId?: string) => {
    set({ selectedModel: model, selectedProviderId: providerId || '' });
  },

  setSelectedAgent: (agent: string) => {
    set({ selectedAgent: agent });
    void api.setSelectedAgent(agent).catch((error) => {
      log.error('agent', 'Failed to persist selected agent', { agent, error: toStoreError(error) });
    });
  },

  setAgentSurface: (agent: string, surface: AgentSurface) => {
    if (!agent) return;
    set((state) => ({
      agentSurfaces: {
        ...state.agentSurfaces,
        [agent]: surface,
      },
    }));
  },

  getAgentSurface: (agent: string) => get().agentSurfaces[agent] || 'chat',

  setAgentRosterOpen: (open: boolean) => {
    set({ agentRosterOpen: open });
  },

  setDefaultAgent: async (agentId: string) => {
    const { agents } = get();
    const nextDefault = agents.find((agent) => agent.id === agentId);
    if (!nextDefault) return;
    const previousAgents = agents;
    const previousDefault = get().defaultAgent;
    const mutationKey = `agent-default:${agentId}`;
    set((state) => ({
      defaultAgent: nextDefault.name,
      agents: state.agents.map((agent) => ({
        ...agent,
        isDefault: agent.id === agentId,
      })),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const result = await api.setDefaultAgent(agentId);
      set((state) => ({
        defaultAgent: result.defaultAgent,
        agents: state.agents.map((agent) => ({
          ...agent,
          isDefault: agent.name === result.defaultAgent,
        })),
        lastLoadedAt: Date.now(),
      }));
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to persist default agent', { agentId, error: message });
      set({ agents: previousAgents, defaultAgent: previousDefault, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  loadModels: async () => {
    set({ loading: true, error: null });
    try {
      const res = await api.listAvailableModels();
      let models = res.models || [];
      log.info('agent', 'Models loaded', { count: models.length });
      const modelIds = new Set(models.map((m) => m.id));
      const preferredDefault = res.default && modelIds.has(res.default) ? res.default : '';
      const currentSelected = get().selectedModel;
      const currentProvider = get().selectedProviderId;

      if (currentSelected && currentProvider && !modelIds.has(currentSelected)) {
        const providerModels = models.filter((m) => m.provider_id === currentProvider);
        const providerName = providerModels[0]?.provider_name || currentProvider;
        const isEndpointId = currentSelected.length > 20;
        const resolvedDisplayName = isEndpointId && providerModels.length > 0
          ? providerModels[0].display_name
          : currentSelected;
        const syntheticEntry = {
          id: currentSelected,
          display_name: resolvedDisplayName,
          provider_id: currentProvider,
          provider_name: providerName,
          type: 'chat' as const,
          context_window: providerModels[0]?.context_window ?? 0,
          enabled: true,
          function_call: providerModels[0]?.function_call ?? false,
          vision: providerModels[0]?.vision ?? false,
          reasoning: providerModels[0]?.reasoning ?? false,
          search: providerModels[0]?.search ?? false,
          image_output: providerModels[0]?.image_output ?? false,
          video: providerModels[0]?.video ?? false,
        };
        models = [...models, syntheticEntry];
        modelIds.add(currentSelected);
      }

      const nextSelected =
        (currentSelected && modelIds.has(currentSelected) && currentSelected) ||
        preferredDefault ||
        (currentSelected && currentSelected !== `${currentProvider || ''}:default` && currentSelected) ||
        models[0]?.id ||
        '';
      const nextProvider = models.find((m) => m.id === nextSelected)?.provider_id
        || (currentSelected === nextSelected ? currentProvider : '')
        || models[0]?.provider_id
        || '';
      set({
        availableModels: models,
        defaultModel: preferredDefault || models[0]?.id || '',
        selectedModel: nextSelected,
        selectedProviderId: nextProvider,
        lastLoadedAt: Date.now(),
      });
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to load models', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  loadAgents: async () => {
    set({ loading: true, error: null });
    try {
      const [result, persistedSelected] = await Promise.all([
        api.listAgentsWithMeta(),
        api.getSelectedAgent().catch((error) => {
          log.warn('agent', 'Failed to load selected agent', { error: toStoreError(error) });
          return '';
        }),
      ]);
      const raw = result.agents || [];
      const agents = raw.map((a) => ({
        ...a,
        title: resolveI18nValue(a.title),
        description: resolveI18nValue(a.description),
      }));
      log.info('agent', 'Agents loaded', { count: agents.length });
      const currentSelected = persistedSelected || get().selectedAgent;
      const fallbackAgent = result.defaultAgent || agents.find((agent) => agent.isDefault)?.name || agents[0]?.name || 'assistant';
      const nextSelected = agents.some((a) => a.name === currentSelected)
        ? currentSelected
        : fallbackAgent;
      set({ agents, selectedAgent: nextSelected, defaultAgent: fallbackAgent, lastLoadedAt: Date.now() });
      if (nextSelected && nextSelected !== persistedSelected) {
        void api.setSelectedAgent(nextSelected).catch((error) => {
          log.error('agent', 'Failed to reconcile selected agent', { agent: nextSelected, error: toStoreError(error) });
        });
      }
      const current = agents.find((a) => a.name === nextSelected);
      if (current?.model) {
        const providerId = current.provider?.trim() || '';
        const modelId = current.model.trim();
        set({ selectedModel: modelId, selectedProviderId: providerId || get().selectedProviderId });
      }
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to load agents', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  loadApplets: async () => {
    set({ loading: true, error: null });
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
      set({ applets, enabledAppletIds: activeIds, lastLoadedAt: Date.now() });
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to load applets', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  toggleApplet: async (id: string) => {
    const previousIds = get().enabledAppletIds;
    const mutationKey = `applet:${id}`;
    const enabled = previousIds.includes(id);
    const nextIds = enabled
      ? previousIds.filter((x) => x !== id)
      : [...previousIds, id];
    set((s) => {
      return {
        enabledAppletIds: nextIds,
        error: null,
        pendingMutations: beginMutation(s.pendingMutations, mutationKey),
      };
    });
    try {
      if (id === 'web-search') {
        await api.setPreferences({ web_search_enabled: !enabled });
      }
      await get().loadApplets();
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to toggle applet', { id, error: message });
      set({ enabledAppletIds: previousIds, error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  updateAgentConfig: async (agentName: string, updates: { chatConfig?: Partial<AgentChatConfig> }) => {
    const { agents } = get();
    const agent = agents.find((a) => a.name === agentName);
    if (!agent) return;

    const payload: Record<string, string> = {};

    if (updates.chatConfig) {
      const existing = parseAgentChatConfig(agent);
      const merged = { ...existing, ...updates.chatConfig };
      payload.chatConfig = JSON.stringify(merged);
    }
    const previousAgents = agents;
    const optimisticAgent = { ...agent, ...payload };
    const mutationKey = `agent:${agent.id}`;
    set((state) => ({
      agents: state.agents.map((item) => (item.id === agent.id ? optimisticAgent : item)),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));

    try {
      const updated = await api.updateAgent(agent.id, payload);
      set((s) => ({
        agents: s.agents.map((a) => (a.id === updated.id ? updated : a)),
        lastLoadedAt: Date.now(),
      }));
    } catch (e) {
      const message = toStoreError(e);
      log.error('agent', 'Failed to update agent config', { agentName, error: message });
      set({ agents: previousAgents, error: message });
      throw e;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  getCurrentAgentChatConfig: () => {
    const { agents, selectedAgent } = get();
    const agent = agents.find((a) => a.name === selectedAgent);
    if (!agent) return {};
    return parseAgentChatConfig(agent);
  },
}));
