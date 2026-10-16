import { createDesktopStore } from './createDesktopStore';
import {
  api,
  type AccountIdentity,
  type ActorDevice,
  type Agent,
  type GroupAdmissionPreferenceData,
  type NotificationPreferenceData,
  type NotificationPreferencePatchInput,
  type RejectedGroupData,
} from '../services/desktop_api';
import { toolService, type ToolInfo } from '../services/tool-service';
import { log } from '../utils/logger';
import {
  DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  normalizeChatScreenshotShortcut,
} from '../utils/chatScreenshotShortcut';
import { beginMutation, endMutation, toStoreError, type RevalidationState } from './revalidation';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';

const CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY = 'settings.chat.screenshotShortcut';

interface SettingsSessionFence {
  actorPtid: string;
  sessionEpoch: number;
}

function currentSettingsSessionFence(): SettingsSessionFence | null {
  const actorPtid = currentAuthenticatedActorPtid();
  if (!actorPtid) return null;
  return {
    actorPtid,
    sessionEpoch: useSessionStore.getState().sessionEpoch,
  };
}

function settingsSessionFenceMatches(fence: SettingsSessionFence): boolean {
  return currentAuthenticatedActorPtid() === fence.actorPtid
    && useSessionStore.getState().sessionEpoch === fence.sessionEpoch;
}

function registerChatScreenshotShortcut(shortcut: string): void {
  api.chatScreenshotShortcutRegister({ shortcut }).catch((error) => {
    log.warn('settings', 'Failed to register chat screenshot shortcut', error);
  });
}

interface SettingsState extends RevalidationState {
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
  /** Station-authoritative device projection for Settings > Network. */
  devices: ActorDevice[];
  currentDeviceId: string;
  devicesLoading: boolean;
  devicesError: string | null;
  deviceRevokingId: string | null;
  /** Station-authoritative per-category notification preferences. */
  notificationPreferences: NotificationPreferenceData[];
  notificationPreferencesRevision: number;
  notificationPreferencesLoading: boolean;
  notificationPreferencesError: string | null;
  notificationPreferenceSavingCategory: number | null;
  groupAdmissionPreference: GroupAdmissionPreferenceData | null;
  rejectedGroups: RejectedGroupData[];
  groupAdmissionLoading: boolean;
  groupAdmissionError: string | null;
  groupAdmissionMutating: boolean;
  chatScreenshotShortcut: string;

  loadChatPreferences: () => Promise<void>;
  loadAgents: () => Promise<void>;
  loadTools: () => Promise<void>;
  refreshActiveAccount: () => Promise<void>;
  clearSessionProjection: () => void;
  refreshDevices: () => Promise<void>;
  revokeDevice: (deviceId: string, observedProfileVersion: bigint) => Promise<void>;
  clearDeviceProjection: () => void;
  refreshNotificationPreferences: () => Promise<void>;
  updateNotificationPreference: (
    category: number,
    patch: Omit<NotificationPreferencePatchInput, 'category'>,
  ) => Promise<void>;
  clearNotificationPreferences: () => void;
  refreshGroupAdmission: () => Promise<void>;
  updateGroupAdmissionMode: (mode: number) => Promise<void>;
  removeRejectedGroup: (conversationId: string) => Promise<void>;
  retryRejectedGroupLeave: (operationId: string) => Promise<void>;
  clearGroupAdmission: () => void;
  setChatScreenshotShortcut: (shortcut: string) => void;
  setCurrentAgent: (name: string) => void;
  setDefaultAgent: (id: string) => Promise<void>;
  updateAgent: (name: string, data: Partial<Agent>) => Promise<void>;
}

export const useSettingsStore = createDesktopStore<SettingsState>('settings', (set, get) => ({
  agents: [],
  tools: [],
  currentAgent: 'assistant',
  activeAccount: null,
  devices: [],
  currentDeviceId: '',
  devicesLoading: false,
  devicesError: null,
  deviceRevokingId: null,
  notificationPreferences: [],
  notificationPreferencesRevision: 0,
  notificationPreferencesLoading: false,
  notificationPreferencesError: null,
  notificationPreferenceSavingCategory: null,
  groupAdmissionPreference: null,
  rejectedGroups: [],
  groupAdmissionLoading: false,
  groupAdmissionError: null,
  groupAdmissionMutating: false,
  chatScreenshotShortcut: DEFAULT_CHAT_SCREENSHOT_SHORTCUT,
  loading: false,
  error: null,
  lastLoadedAt: null,
  pendingMutations: {},

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
    set({ loading: true, error: null });
    try {
      const agents = await api.listAgents();
      set({ agents, lastLoadedAt: Date.now() });
      const rustResult = await api.settingsGet({ key: 'settings.currentAgent' });
      if (rustResult.ok) {
        const value = (rustResult.data as { value?: string } | undefined)?.value;
        if (value) {
          set({ currentAgent: value });
        }
      }
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to load agents', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  loadTools: async () => {
    set({ loading: true, error: null });
    try {
      const tools = await toolService.list();
      set({ tools, lastLoadedAt: Date.now() });
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to load tools', { error: message });
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },

  refreshActiveAccount: async () => {
    const fence = currentSettingsSessionFence();
    if (!fence) {
      set({ activeAccount: null });
      return;
    }
    try {
      const active = await api.accountGetActive();
      if (!settingsSessionFenceMatches(fence)) return;
      set({ activeAccount: active ?? null });
    } catch (e) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(e);
      log.warn('settings', 'Failed to refresh active account', { error: message });
      set({ error: message });
    }
  },

  clearSessionProjection: () => set({
    activeAccount: null,
    devices: [],
    currentDeviceId: '',
    devicesLoading: false,
    devicesError: null,
    deviceRevokingId: null,
    notificationPreferences: [],
    notificationPreferencesRevision: 0,
    notificationPreferencesLoading: false,
    notificationPreferencesError: null,
    notificationPreferenceSavingCategory: null,
    groupAdmissionPreference: null,
    rejectedGroups: [],
    groupAdmissionLoading: false,
    groupAdmissionError: null,
    groupAdmissionMutating: false,
  }),

  refreshDevices: async () => {
    const fence = currentSettingsSessionFence();
    if (!fence) {
      get().clearDeviceProjection();
      return;
    }
    set({ devicesLoading: true, devicesError: null });
    try {
      const [devices, current] = await Promise.all([
        api.deviceList(),
        api.accountGetDeviceId(),
      ]);
      if (!settingsSessionFenceMatches(fence)) return;
      set({
        devices,
        currentDeviceId: current.device_id,
        devicesLoading: false,
        devicesError: null,
      });
    } catch (e) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(e);
      log.warn('settings', 'Failed to refresh authorized devices', { error: message });
      set({
        devicesLoading: false,
        devicesError: message,
      });
    }
  },

  revokeDevice: async (deviceId, observedProfileVersion) => {
    const fence = currentSettingsSessionFence();
    if (!fence) throw new Error('settings.devices.sessionUnavailable');
    set({ deviceRevokingId: deviceId, devicesError: null });
    try {
      const revoked = await api.deviceRevoke(deviceId, observedProfileVersion);
      if (!settingsSessionFenceMatches(fence)) return;
      set((state) => ({
        devices: state.devices.map((device) => (
          device.ref?.deviceId === deviceId ? revoked : device
        )),
      }));
    } catch (e) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(e);
      log.warn('settings', 'Failed to revoke authorized device', {
        deviceId,
        error: message,
      });
      set({ devicesError: message });
      throw e;
    } finally {
      if (settingsSessionFenceMatches(fence)) {
        set({ deviceRevokingId: null });
      }
    }
  },

  clearDeviceProjection: () => set({
    devices: [],
    currentDeviceId: '',
    devicesLoading: false,
    devicesError: null,
    deviceRevokingId: null,
  }),

  refreshNotificationPreferences: async () => {
    const fence = currentSettingsSessionFence();
    if (!fence) {
      get().clearNotificationPreferences();
      return;
    }
    set({
      notificationPreferencesLoading: true,
      notificationPreferencesError: null,
    });
    try {
      const snapshot = await api.notificationPreferences();
      if (!settingsSessionFenceMatches(fence)) return;
      set((state) => (
        snapshot.notificationPreferencesRevision < state.notificationPreferencesRevision
          ? { notificationPreferencesLoading: false }
          : {
              notificationPreferences: snapshot.preferences,
              notificationPreferencesRevision: snapshot.notificationPreferencesRevision,
              notificationPreferencesLoading: false,
              notificationPreferencesError: null,
            }
      ));
    } catch (e) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(e);
      log.warn('settings', 'Failed to refresh notification preferences', { error: message });
      set({
        notificationPreferencesLoading: false,
        notificationPreferencesError: message,
      });
    }
  },

  updateNotificationPreference: async (category, patch) => {
    const fence = currentSettingsSessionFence();
    if (!fence) throw new Error('notification.preferences.sessionUnavailable');
    const state = get();
    const current = state.notificationPreferences.find(
      (preference) => preference.category === category,
    );
    if (!current || state.notificationPreferencesRevision <= 0) {
      throw new Error('notification.preferences.unavailable');
    }

    set({
      notificationPreferenceSavingCategory: category,
      notificationPreferencesError: null,
    });
    try {
      const result = await api.notificationPreferencesUpdate({
        updates: [{
          category,
          enabled: patch.enabled,
          pushEnabled: patch.pushEnabled,
          soundEnabled: patch.soundEnabled,
        }],
        observedRevision: state.notificationPreferencesRevision,
      });
      if (!settingsSessionFenceMatches(fence)) return;
      set((currentState) => (
        result.snapshot.notificationPreferencesRevision
          < currentState.notificationPreferencesRevision
          ? {}
          : {
              notificationPreferences: result.snapshot.preferences,
              notificationPreferencesRevision:
                result.snapshot.notificationPreferencesRevision,
            }
      ));
      if (
        result.outcome
        === 'NOTIFICATION_PREFERENCES_UPDATE_OUTCOME_CONFLICT'
      ) {
        throw new Error('notification.preferences.conflict');
      }
    } catch (e) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(e);
      log.warn('settings', 'Failed to update notification preference', {
        category,
        error: message,
      });
      set({ notificationPreferencesError: message });
      throw e;
    } finally {
      if (settingsSessionFenceMatches(fence)) {
        set({ notificationPreferenceSavingCategory: null });
      }
    }
  },

  clearNotificationPreferences: () => set({
    notificationPreferences: [],
    notificationPreferencesRevision: 0,
    notificationPreferencesLoading: false,
    notificationPreferencesError: null,
    notificationPreferenceSavingCategory: null,
  }),

  refreshGroupAdmission: async () => {
    const fence = currentSettingsSessionFence();
    if (!fence) {
      get().clearGroupAdmission();
      return;
    }
    set({ groupAdmissionLoading: true, groupAdmissionError: null });
    try {
      const snapshot = await api.groupAdmissionSettings();
      if (!settingsSessionFenceMatches(fence)) return;
      set({
        groupAdmissionPreference: snapshot.preference,
        rejectedGroups: snapshot.rejectedGroups,
        groupAdmissionLoading: false,
        groupAdmissionError: null,
      });
    } catch (error) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(error);
      log.warn('settings', 'Failed to refresh group admission settings', { error: message });
      set({ groupAdmissionLoading: false, groupAdmissionError: message });
    }
  },

  updateGroupAdmissionMode: async (mode) => {
    const fence = currentSettingsSessionFence();
    const preference = get().groupAdmissionPreference;
    if (!fence || !preference) {
      throw new Error('settings.groupAdmission.sessionUnavailable');
    }
    set({ groupAdmissionMutating: true, groupAdmissionError: null });
    try {
      const updated = await api.updateGroupAdmissionPreference(
        mode,
        preference.revision,
      );
      if (!settingsSessionFenceMatches(fence)) return;
      set({ groupAdmissionPreference: updated });
    } catch (error) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(error);
      set({ groupAdmissionError: message });
      throw error;
    } finally {
      if (settingsSessionFenceMatches(fence)) {
        set({ groupAdmissionMutating: false });
      }
    }
  },

  removeRejectedGroup: async (conversationId) => {
    const fence = currentSettingsSessionFence();
    const preference = get().groupAdmissionPreference;
    if (!fence || !preference) {
      throw new Error('settings.groupAdmission.sessionUnavailable');
    }
    set({ groupAdmissionMutating: true, groupAdmissionError: null });
    try {
      const updated = await api.removeRejectedGroup(
        conversationId,
        preference.revision,
      );
      if (!settingsSessionFenceMatches(fence)) return;
      set((state) => ({
        groupAdmissionPreference: updated,
        rejectedGroups: state.rejectedGroups.filter(
          (group) => group.conversationId !== conversationId,
        ),
      }));
    } catch (error) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(error);
      set({ groupAdmissionError: message });
      throw error;
    } finally {
      if (settingsSessionFenceMatches(fence)) {
        set({ groupAdmissionMutating: false });
      }
    }
  },

  retryRejectedGroupLeave: async (operationId) => {
    const fence = currentSettingsSessionFence();
    if (!fence || !operationId) {
      throw new Error('settings.groupAdmission.sessionUnavailable');
    }
    set({ groupAdmissionMutating: true, groupAdmissionError: null });
    try {
      await api.retryLeaveAndRejectGroup(operationId);
      if (!settingsSessionFenceMatches(fence)) return;
      await get().refreshGroupAdmission();
    } catch (error) {
      if (!settingsSessionFenceMatches(fence)) return;
      const message = toStoreError(error);
      set({ groupAdmissionError: message });
      throw error;
    } finally {
      if (settingsSessionFenceMatches(fence)) {
        set({ groupAdmissionMutating: false });
      }
    }
  },

  clearGroupAdmission: () => set({
    groupAdmissionPreference: null,
    rejectedGroups: [],
    groupAdmissionLoading: false,
    groupAdmissionError: null,
    groupAdmissionMutating: false,
  }),

  setCurrentAgent: (name: string) => {
    set({ currentAgent: name });
    api.settingsSet({ key: 'settings.currentAgent', value: name }).catch((error) => {
      const message = toStoreError(error);
      log.error('settings', 'Failed to persist current agent', { name, error: message });
      set({ error: message });
    });
  },

  setDefaultAgent: async (id: string) => {
    const previousAgents = get().agents;
    const target = previousAgents.find((agent) => agent.id === id);
    if (!target) return;
    const mutationKey = `agent-default:${id}`;
    set((state) => ({
      agents: state.agents.map((agent) => ({
        ...agent,
        isDefault: agent.id === id,
      })),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const result = await api.setDefaultAgent(id);
      set((state) => ({
        agents: state.agents.map((agent) => ({
          ...agent,
          isDefault: agent.name === result.defaultAgent,
        })),
        currentAgent: result.defaultAgent,
        lastLoadedAt: Date.now(),
      }));
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to persist default agent', { id, error: message });
      set({ agents: previousAgents, error: message });
      throw e;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },

  setChatScreenshotShortcut: (shortcut: string) => {
    const normalized = normalizeChatScreenshotShortcut(shortcut);
    set({ chatScreenshotShortcut: normalized });
    api.settingsSet({ key: CHAT_SCREENSHOT_SHORTCUT_SETTING_KEY, value: normalized }).catch((error) => {
      const message = toStoreError(error);
      log.warn('settings', 'Failed to persist chat screenshot shortcut', { error: message });
      set({ error: message });
    });
    registerChatScreenshotShortcut(normalized);
  },

  updateAgent: async (name: string, data: Partial<Agent>) => {
    const previousAgents = get().agents;
    const mutationKey = `agent:${name}`;
    set((state) => ({
      agents: state.agents.map((agent) => (agent.name === name ? { ...agent, ...data } : agent)),
      error: null,
      pendingMutations: beginMutation(state.pendingMutations, mutationKey),
    }));
    try {
      const agents = await api.listAgents();
      const agent = agents.find((a) => a.name === name);
      if (agent) {
        await api.updateAgent(agent.id, data);
      }
      const updated = await api.listAgents();
      set({ agents: updated, lastLoadedAt: Date.now() });
    } catch (e) {
      const message = toStoreError(e);
      log.error('settings', 'Failed to update agent', { name, error: message });
      set({ agents: previousAgents, error: message });
      throw e;
    } finally {
      set((state) => ({ pendingMutations: endMutation(state.pendingMutations, mutationKey) }));
    }
  },
}));
