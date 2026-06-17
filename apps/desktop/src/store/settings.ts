import { create } from 'zustand';
import { api, type AccountIdentity, type Agent, type ToolInfo } from '../services/desktop_api';
import { log } from '../utils/logger';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  normalizeChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';

const CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY = 'settings.chat.screenshotShortcut';

function registerChatScreenshotShortcut(shortcut: string): void {
  api.chatScreenshotShortcutRegister({ shortcut }).catch((error) => {
    log.warn('settings', 'Failed to register chat screenshot shortcut', error);
  });
}

interface SettingsState {
  agents: Agent[];
  tools: ToolInfo[];
  currentAgent: string;
  /**
   * Active account snapshot, refreshed by `runtimes/settingsRuntime.ts`
   * on bootstrap and visibility events. The Security section reads
   * `has_pin` / `id` from here synchronously so the first click on
   * "Settings" never triggers an `accountGetActive` round-trip.
   */
  activeAccount: AccountIdentity | null;
  chatScreenshotShortcut: string;

  loadChatPreferences: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  refreshActiveAccount: () => Promise<void>;
  setChatScreenshotShortcut: (shortcut: string) => void;
  setCurrentAgent: (name: string) => void;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  agents: [],
  tools: [],
  currentAgent: 'assistant',
  activeAccount: null,
  chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,

  loadChatPreferences: async () => {
    try {
      const rustResult = await api.settingsGet({ key: CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY });
      const value = rustResult.ok
        ? (rustResult.data as { value?: unknown } | undefined)?.value
        : undefined;
      const shortcut = normalizeChatScreenshotShortcut(value);
      set({ chatScreenshotShortcut: shortcut });
      registerChatScreenshotShortcut(shortcut);
    } catch (e) {
      log.warn('settings', 'Failed to load chat preferences', e);
      registerChatScreenshotShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT);
    }
  },

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
      log.error('settings', 'Failed to load agents', e);
    }
  },

  loadTools: async () => {
    try {
      const tools = await api.listTools();
      set({ tools });
    } catch (e) {
      log.error('settings', 'Failed to load tools', e);
    }
  },

  refreshActiveAccount: async () => {
    try {
      const active = await api.accountGetActive();
      set({ activeAccount: active ?? null });
    } catch (e) {
      log.warn('settings', 'Failed to refresh active account', e);
    }
  },

  setCurrentAgent: (name: string) => {
    set({ currentAgent: name });
    api.settingsSet({ key: 'settings.currentAgent', value: name }).catch(() => {});
  },

  setChatScreenshotShortcut: (shortcut: string) => {
    const normalized = normalizeChatScreenshotShortcut(shortcut);
    set({ chatScreenshotShortcut: normalized });
    api.settingsSet({ key: CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY, value: normalized }).catch(() => {});
    registerChatScreenshotShortcut(normalized);
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
      log.error('settings', 'Failed to update agent', e);
    }
  },
}));
