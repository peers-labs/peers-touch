import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { resolveI18nValue } from '../i18n/index';
import {
  api,
  type AvailableModel,
  type Agent,
  type AgentCapabilityPermissionKind,
  type AgentCreate,
  type AppletInfo,
} from '../services/desktop_api';
import { useAgentCapabilityStore } from './agentCapabilities';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';

type AgentSurface = 'chat' | 'profile';
export type AgentSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict';
export interface AgentCapabilityFocus {
  capabilityId: string;
  permissionKind: AgentCapabilityPermissionKind;
  requestId: string;
}

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
  capabilityFocusByAgent: Record<string, AgentCapabilityFocus>;
  agentRosterOpen: boolean;
  saveStateByAgentId: Record<string, AgentSaveState>;

  setSelectedModel: (model: string, providerId?: string) => void;
  setSelectedAgent: (agent: string) => void;
  setAgentSurface: (agent: string, surface: AgentSurface) => void;
  focusAgentCapability: (
    agent: string,
    capabilityId: string,
    permissionKind: AgentCapabilityPermissionKind,
  ) => void;
  getAgentSurface: (agent: string) => AgentSurface;
  setAgentRosterOpen: (open: boolean) => void;
  setDefaultAgent: (agentId: string) => Promise<void>;
  loadModels: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadApplets: () => Promise<void>;
  toggleApplet: (id: string) => Promise<void>;
  createAgent: (input: AgentCreate) => Promise<Agent>;
  duplicateAgent: (agentId: string) => Promise<Agent>;
  deleteAgent: (agentId: string) => Promise<void>;
  updateAgentProfile: (agentId: string, updates: Partial<AgentCreate>) => Promise<Agent>;
  reloadAgentProfile: (agentId: string) => Promise<Agent>;
}

const ACTIVE_MUTATION_CONFLICT_CODE = 'ADMISSION_ACTIVE_MUTATION_CONFLICT';

export function isActiveMutationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('details' in error)) return false;
  const details = (error as { details?: unknown }).details;
  return (
    typeof details === 'object'
    && details !== null
    && !Array.isArray(details)
    && (details as Record<string, unknown>).error_code === ACTIVE_MUTATION_CONFLICT_CODE
  );
}

function reconcileAgent(agent: Agent): Agent {
  return {
    ...agent,
    title: resolveI18nValue(agent.title),
    description: resolveI18nValue(agent.description),
  };
}

function firstExistingAgentName(agents: Agent[], candidates: Array<string | undefined>): string {
  return candidates.find(
    (candidate) => candidate && agents.some((agent) => agent.name === candidate),
  ) || '';
}

function reconcileAgentRoster(
  agents: Agent[],
  selectedCandidates: Array<string | undefined>,
  defaultCandidate?: string,
) {
  const defaultAgent = firstExistingAgentName(agents, [
    defaultCandidate,
    agents.find((agent) => agent.isDefault)?.name,
    agents[0]?.name,
  ]) || 'assistant';
  const selectedAgent = firstExistingAgentName(agents, [
    ...selectedCandidates,
    defaultAgent,
  ]) || defaultAgent;
  const reconciledAgents = agents.map((agent) => ({
    ...agent,
    isDefault: agent.name === defaultAgent,
  }));
  const selected = reconciledAgents.find((agent) => agent.name === selectedAgent);

  return {
    agents: reconciledAgents,
    selectedAgent,
    defaultAgent,
    selectedModel: selected?.model?.trim() || '',
    selectedProviderId: selected?.provider?.trim() || '',
  };
}

function nextAgentCopyName(sourceName: string, agents: Agent[]): string {
  const baseName = `${sourceName.trim()}-copy`;
  const existingNames = new Set(agents.map((agent) => agent.name));
  if (!existingNames.has(baseName)) return baseName;

  let copyNumber = 2;
  while (existingNames.has(`${baseName}-${copyNumber}`)) {
    copyNumber += 1;
  }
  return `${baseName}-${copyNumber}`;
}

function withoutRecordKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
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
  capabilityFocusByAgent: {},
  agentRosterOpen: true,
  saveStateByAgentId: {},
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  setSelectedModel: (model: string, providerId?: string) => {
    const state = get();
    const agent = state.agents.find((item) => item.name === state.selectedAgent);
    if (!agent) return;
    const previousModel = agent.model;
    const previousProvider = agent.provider;
    set({ selectedModel: model, selectedProviderId: providerId || '' });
    void state.updateAgentProfile(agent.id, {
      model,
      provider: providerId || '',
    }).catch(() => {
      set({ selectedModel: previousModel, selectedProviderId: previousProvider });
    });
  },

  setSelectedAgent: (agent: string) => {
    const selected = get().agents.find((item) => item.name === agent);
    set({
      selectedAgent: agent,
      selectedModel: selected?.model || '',
      selectedProviderId: selected?.provider || '',
    });
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

  focusAgentCapability: (agent, capabilityId, permissionKind) => {
    if (!agent || !capabilityId) return;
    set((state) => ({
      capabilityFocusByAgent: {
        ...state.capabilityFocusByAgent,
        [agent]: {
          capabilityId,
          permissionKind,
          requestId: crypto.randomUUID(),
        },
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
      const models = res.models || [];
      log.info('agent', 'Models loaded', { count: models.length });
      const enabledModels = models.filter((m) => m.enabled);
      set({
        availableModels: models,
        defaultModel: res.default || enabledModels[0]?.id || '',
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
      let agents = (result.agents || []).map(reconcileAgent);
      let selectedCandidates = [
        persistedSelected,
        result.selectedAgent,
        get().selectedAgent,
      ];
      let defaultCandidate = result.defaultAgent;
      if (agents.length === 0) {
        try {
          const created = reconcileAgent(
            await api.createAgent({ name: 'assistant', description: '' }),
          );
          agents = [created];
          selectedCandidates = [created.name];
          defaultCandidate = created.name;
        } catch (createError) {
          log.warn('agent', 'Auto-create default agent failed', { error: toStoreError(createError) });
        }
      }
      log.info('agent', 'Agents loaded', { count: agents.length });
      const roster = reconcileAgentRoster(agents, selectedCandidates, defaultCandidate);
      set({ ...roster, lastLoadedAt: Date.now() });
      const nextSelected = roster.selectedAgent;
      if (nextSelected && nextSelected !== persistedSelected) {
        void api.setSelectedAgent(nextSelected).catch((error) => {
          log.error('agent', 'Failed to reconcile selected agent', { agent: nextSelected, error: toStoreError(error) });
        });
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

  createAgent: async (input) => {
    // First-class agent creation (C5): wraps api.createAgent (Station-backed),
    // then merges the created agent into the roster, selects it and switches to
    // its profile surface. UI entry points reuse this instead of calling the API
    // directly, mirroring LobeHub's store-level createAgent.
    const mutationKey = 'agent-create';
    set((state) => ({ error: null, pendingMutations: beginMutation(state.pendingMutations, mutationKey) }));
    try {
      const created = await api.createAgent(input);
      const reconciled = reconcileAgent(created);
      set((state) => {
        const others = state.agents.filter((item) => item.id !== reconciled.id);
        const roster = reconcileAgentRoster(
          [...others, reconciled],
          [reconciled.name],
          state.defaultAgent,
        );
        return {
          ...roster,
          agentSurfaces: { ...state.agentSurfaces, [reconciled.name]: 'profile' },
          lastLoadedAt: Date.now(),
        };
      });
      void api.setSelectedAgent(reconciled.name).catch(() => { /* selection best-effort */ });
      return reconciled;
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to create agent', { error: message });
      set({ error: message });
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  duplicateAgent: async (agentId) => {
    const source = get().agents.find((agent) => agent.id === agentId);
    if (!source) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const cloneName = nextAgentCopyName(source.name, get().agents);
    const mutationKey = `agent-duplicate:${agentId}`;
    set((state) => ({
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const cloned = reconcileAgent(await api.duplicateAgent(agentId, cloneName));
      set((state) => {
        const others = state.agents.filter((agent) => agent.id !== cloned.id);
        return {
          ...reconcileAgentRoster(
            [...others, cloned],
            [cloned.name],
            state.defaultAgent,
          ),
          lastLoadedAt: Date.now(),
        };
      });
      await api.setSelectedAgent(cloned.name).catch((error) => {
        log.error('agent', 'Failed to persist cloned Agent selection', {
          agentId: cloned.id,
          error: toStoreError(error),
        });
      });
      return cloned;
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to duplicate agent', { agentId, error: message });
      set({ error: message });
      throw error;
    } finally {
      set((state) => ({
        pendingMutations: endMutation(state.pendingMutations, mutationKey),
      }));
    }
  },

  deleteAgent: async (agentId) => {
    const deleted = get().agents.find((agent) => agent.id === agentId);
    if (!deleted) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const mutationKey = `agent-delete:${agentId}`;
    set((state) => ({
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      await api.deleteAgent(agentId);
      set((state) => {
        const remaining = state.agents.filter((agent) => agent.id !== agentId);
        return {
          ...reconcileAgentRoster(
            remaining,
            [state.selectedAgent],
            state.defaultAgent,
          ),
          agentSurfaces: withoutRecordKey(state.agentSurfaces, deleted.name),
          capabilityFocusByAgent: withoutRecordKey(
            state.capabilityFocusByAgent,
            deleted.name,
          ),
          saveStateByAgentId: withoutRecordKey(state.saveStateByAgentId, agentId),
          lastLoadedAt: Date.now(),
        };
      });
      await get().loadAgents();
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to delete agent', { agentId, error: message });
      set({ error: message });
      throw error;
    } finally {
      set((state) => ({
        pendingMutations: endMutation(state.pendingMutations, mutationKey),
      }));
    }
  },

  updateAgentProfile: async (agentId, updates) => {
    const { agents } = get();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    const previousAgents = agents;
    const mutationKey = `agent-profile:${agentId}`;
    const optimisticAgent: Agent = { ...agent, ...updates };

    set((state) => ({
      agents: state.agents.map((item) => (item.id === agentId ? optimisticAgent : item)),
      error: null,
      saveStateByAgentId: { ...state.saveStateByAgentId, [agentId]: 'saving' },
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));

    try {
      const updated = await api.updateAgent(agentId, { ...updates, version: agent.version });
      const reconciled = reconcileAgent(updated);
      set((state) => ({
        agents: state.agents.map((item) => (item.id === reconciled.id ? reconciled : item)),
        saveStateByAgentId: { ...state.saveStateByAgentId, [agentId]: 'saved' },
        lastLoadedAt: Date.now(),
      }));
      try {
        await useAgentCapabilityStore.getState().loadAgent(agentId);
      } catch (error) {
        const message = toStoreError(error);
        log.error('agent', 'Failed to refresh capability projection after Agent update', {
          agentId,
          error: message,
        });
        set({ error: message });
      }
      return reconciled;
    } catch (error) {
      const message = toStoreError(error);
      const conflict = isActiveMutationConflict(error);
      log.error('agent', 'Failed to update agent profile', { agentId, error: message });
      set((state) => ({
        agents: previousAgents,
        error: message,
        saveStateByAgentId: {
          ...state.saveStateByAgentId,
          [agentId]: conflict ? 'conflict' : 'failed',
        },
      }));
      throw error;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  reloadAgentProfile: async (agentId) => {
    const mutationKey = `agent-profile-reload:${agentId}`;
    set((state) => ({
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const reloaded = reconcileAgent(await api.getAgent(agentId));
      set((state) => {
        const selectedAgent = state.selectedAgent === reloaded.name;
        return {
          agents: state.agents.map((item) => (item.id === reloaded.id ? reloaded : item)),
          error: null,
          saveStateByAgentId: {
            ...state.saveStateByAgentId,
            [agentId]: 'idle',
          },
          selectedModel: selectedAgent ? reloaded.model : state.selectedModel,
          selectedProviderId: selectedAgent ? reloaded.provider : state.selectedProviderId,
          lastLoadedAt: Date.now(),
        };
      });
      return reloaded;
    } catch (error) {
      const message = toStoreError(error);
      log.error('agent', 'Failed to reload authoritative agent profile', {
        agentId,
        error: message,
      });
      set({ error: message });
      throw error;
    } finally {
      set((state) => ({
        pendingMutations: endMutation(state.pendingMutations, mutationKey),
      }));
    }
  },
}));
