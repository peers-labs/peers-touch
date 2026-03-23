import { create } from 'zustand';
import { api, type Agent, type ToolInfo } from '../services/api';

interface SettingsState {
  agents: Agent[];
  tools: ToolInfo[];
  currentAgent: string;

  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  setCurrentAgent: (name: string) => void;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  agents: [],
  tools: [],
  currentAgent: 'assistant',

  loadAgents: async () => {
    try {
      const agents = await api.listAgents();
      set({ agents });
      const rustResult = await api.settingsGet({ key: 'settings.currentAgent' });
      if (rustResult.ok) {
        const value = (rustResult.data as { value?: string } | undefined)?.value;
        if (value) {
          set({ currentAgent: value });
        }
      }
    } catch (e) {
      console.error('Failed to load agents:', e);
    }
  },

  loadTools: async () => {
    try {
      const tools = await api.listTools();
      set({ tools });
    } catch (e) {
      console.error('Failed to load tools:', e);
    }
  },

  setCurrentAgent: (name: string) => {
    set({ currentAgent: name });
    api.settingsSet({ key: 'settings.currentAgent', value: name }).catch(() => {});
  },

  updateAgent: async (name: string, data: Partial<Agent>) => {
    try {
      const agents = await api.listAgents();
      const agent = agents.find((a) => a.name === name);
      if (agent) {
        await api.updateAgent(agent.id, data);
      }
      const updated = await api.listAgents();
      set({ agents: updated });
    } catch (e) {
      console.error('Failed to update agent:', e);
    }
  },
}));
