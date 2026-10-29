import { createDesktopStore } from './createDesktopStore';
import { useSessionStore } from './session';
import { api, type AccountIdentity, type Agent } from '../services/desktop_api';
import { toolService, type ToolInfo } from '../services/tool-service';
import { log } from '../utils/logger';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  normalizeChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';
import {
  PERSONALIZATION_CHAT_SHORTCUT_KEY,
  PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY,
  readPersonalization,
  writePersonalization,
  capturePersonalizationScope,
  isPersonalizationScopeCurrent,
} from '../runtimes/personalization';

let generation = 0;
let chatPreferenceRevision = 0;
let providerPreferenceRevision = 0;
let shortcutEffects = Promise.resolve();

function captureOperation() {
  const observed = generation;
  const scope = capturePersonalizationScope();
  const epoch = useSessionStore.getState().sessionEpoch;
  return {
    scope,
    current: () => observed === generation && epoch === useSessionStore.getState().sessionEpoch
      && isPersonalizationScopeCurrent(scope),
  };
}

function registerChatScreenshotShortcut(shortcut: string, current: () => boolean): void {
  shortcutEffects = shortcutEffects.then(async () => {
    if (current()) await api.chatScreenshotShortcutRegister({ shortcut });
  }).catch((error) => {
    log.warn('settings', 'Failed to register chat screenshot shortcut', error);
  });
}

interface SettingsState extends RevalidationState {
  agents: Agent[];
  tools: ToolInfo[];
  /**
   * Active account snapshot, refreshed by `runtimes/settingsRuntime.ts`
   * on bootstrap and when the session changes. The Security section reads
   * `has_pin` / `id` from here synchronously so the first click on
   * "Settings" never triggers an `accountGetActive` round-trip.
   */
  activeAccount: AccountIdentity | null;
  chatScreenshotShortcut: string;
  showUsableProvidersOnly: boolean;

  loadChatPreferences: () => Promise<void>;
  loadProviderPreferences: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  refreshActiveAccount: () => Promise<void>;
  setChatScreenshotShortcut: (shortcut: string) => void;
  setShowUsableOnly: (show: boolean) => Promise<void>;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
  /** Restore identity-independent defaults after logout / actor switch. */
  resetPersonalization: () => void;
}

export const useSettingsStore = createDesktopStore<SettingsState>('settings', (set) => ({
  agents: [],
  tools: [],
  activeAccount: null,
  chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  showUsableProvidersOnly: true,
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

  loadChatPreferences: async () => {
    const operation = captureOperation();
    const revision = chatPreferenceRevision;
    try {
      const value = await readPersonalization(
        PERSONALIZATION_CHAT_SHORTCUT_KEY,
        operation.scope,
      );
      if (!operation.current() || revision !== chatPreferenceRevision) return;
      const shortcut = normalizeChatScreenshotShortcut(value);
      set({ chatScreenshotShortcut: shortcut });
      registerChatScreenshotShortcut(shortcut, () => operation.current() && revision === chatPreferenceRevision);
    } catch (e) {
      if (!operation.current() || revision !== chatPreferenceRevision) return;
      set({ error: toStoreError(e) });
      log.warn('settings', 'Failed to load chat preferences', e);
      registerChatScreenshotShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT, () => operation.current() && revision === chatPreferenceRevision);
    }
  },

  loadProviderPreferences: async () => {
    const operation = captureOperation();
    const revision = providerPreferenceRevision;
    try {
      const value = await readPersonalization(
        PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY,
        operation.scope,
      );
      if (!operation.current() || revision !== providerPreferenceRevision) return;
      if (value !== null && typeof value !== 'boolean') throw new Error('Invalid Provider display preference');
      set({
        showUsableProvidersOnly: value ?? true,
      });
    } catch (error) {
      if (!operation.current() || revision !== providerPreferenceRevision) return;
      set({ error: toStoreError(error) });
      log.error('settings', 'Failed to load Provider display preference', { error: toStoreError(error) });
    }
  },

  loadAgents: async () => {
    const operation = captureOperation();
    set({ loading: true, error: null });
    try {
      const agents = await api.listAgents();
      if (!operation.current()) return;
      set({ agents, lastLoadedAt: Date.now() });
    } catch (e) {
      if (!operation.current()) return;
      const message = toStoreError(e);
      log.error('settings', 'Failed to load agents', { error: message });
      set({ error: message });
    } finally {
      if (operation.current()) set({ loading: false });
    }
  },

  loadTools: async () => {
    const operation = captureOperation();
    set({ loading: true, error: null });
    try {
      const tools = await toolService.list();
      if (!operation.current()) return;
      set({ tools, lastLoadedAt: Date.now() });
    } catch (e) {
      if (!operation.current()) return;
      const message = toStoreError(e);
      log.error('settings', 'Failed to load tools', { error: message });
      set({ error: message });
    } finally {
      if (operation.current()) set({ loading: false });
    }
  },

  refreshActiveAccount: async () => {
    const operation = captureOperation();
    try {
      const active = await api.accountGetActive();
      if (!operation.current()) return;
      set({ activeAccount: active ?? null });
    } catch (e) {
      if (!operation.current()) return;
      const message = toStoreError(e);
      log.error('settings', 'Failed to refresh active account', { error: message });
      set({ error: message });
    }
  },

  setChatScreenshotShortcut: (shortcut) => {
    chatPreferenceRevision += 1;
    const revision = chatPreferenceRevision;
    const operation = captureOperation();
    const normalized = normalizeChatScreenshotShortcut(shortcut);
    set({ chatScreenshotShortcut: normalized });
    void writePersonalization(PERSONALIZATION_CHAT_SHORTCUT_KEY, normalized, operation.scope)
      .then((persisted) => {
        if (!persisted) {
          log.warn('settings', 'Chat shortcut change held without an active identity');
        }
      })
      .catch((error) => {
        log.error('settings', 'Failed to persist chat screenshot shortcut', { error: toStoreError(error) });
      });
    registerChatScreenshotShortcut(normalized, () => operation.current() && revision === chatPreferenceRevision);
  },

  setShowUsableOnly: async (show) => {
    providerPreferenceRevision += 1;
    const operation = captureOperation();
    set({ showUsableProvidersOnly: show });
    try {
      const persisted = await writePersonalization(
        PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY,
        show,
        operation.scope,
      );
      if (!persisted) {
        log.warn('settings', 'Provider filter change held without an active identity');
      }
    } catch (error) {
      if (!operation.current()) return;
      const message = toStoreError(error);
      log.error('settings', 'Failed to persist Provider display preference', { error: message });
      throw error;
    }
  },

  updateAgent: async (name, data) => {
    const operation = captureOperation();
    const mutationKey = `agent:${name}`;
    set((state) => ({
      agents: state.agents.map((agent) => (agent.name === name ? { ...agent, ...data } : agent)),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const agents = await api.listAgents();
      if (!operation.current()) return;
      const agent = agents.find((a) => a.name === name);
      if (agent) {
        await api.updateAgent(agent.id, data);
      }
      const updated = await api.listAgents();
      if (!operation.current()) return;
      set({ agents: updated, lastLoadedAt: Date.now() });
    } catch (e) {
      if (!operation.current()) throw e;
      const message = toStoreError(e);
      log.error('settings', 'Failed to update agent', { name, error: message });
      set({ error: message });
      throw e;
    } finally {
      if (operation.current()) set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  resetPersonalization: () => {
    generation += 1;
    set({
      agents: [],
      tools: [],
      activeAccount: null,
      loading: false,
      error: null,
      lastLoadedAt: null,
      pendingMutations: {},
      chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
      showUsableProvidersOnly: true,
    });
    registerChatScreenshotShortcut(DEFAULT_CHAT_SCREENSHOT_SHORTCUT, captureOperation().current);
  },
}));
