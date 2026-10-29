import { beforeEach, describe, expect, it, vi } from 'vitest';

const personalization = vi.hoisted(() => ({
  readPersonalization: vi.fn(),
  writePersonalization: vi.fn(),
  capturePersonalizationScope: () => null,
  isPersonalizationScopeCurrent: () => true,
}));

const api = vi.hoisted(() => ({
  chatScreenshotShortcutRegister: vi.fn(),
  listAgents: vi.fn(),
  accountGetActive: vi.fn(),
}));

vi.mock('../runtimes/personalization', () => ({
  PERSONALIZATION_CHAT_SHORTCUT_KEY: 'settings.chat.screenshotShortcut',
  PERSONALIZATION_SHOW_USABLE_PROVIDERS_KEY: 'settings.providers.showUsableOnly',
  readPersonalization: personalization.readPersonalization,
  writePersonalization: personalization.writePersonalization,
  capturePersonalizationScope: personalization.capturePersonalizationScope,
  isPersonalizationScopeCurrent: personalization.isPersonalizationScopeCurrent,
}));

vi.mock('./session', () => ({
  useSessionStore: { getState: () => ({ sessionEpoch: 0 }) },
}));
vi.mock('../services/desktop_api', () => ({ api }));
vi.mock('../services/tool-service', () => ({
  toolService: { list: vi.fn() },
}));

import { useSettingsStore } from './settings';

describe('provider display preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalization.writePersonalization.mockResolvedValue(true);
    useSettingsStore.setState({
      showUsableProvidersOnly: true,
      chatScreenshotShortcut: 'Mod+Shift+A',
      error: null,
    });
  });

  it('loads the actor-scoped preference', async () => {
    personalization.readPersonalization.mockResolvedValue(false);

    await useSettingsStore.getState().loadProviderPreferences();

    expect(personalization.readPersonalization).toHaveBeenCalledWith(
      'settings.providers.showUsableOnly',
      null,
    );
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(false);
  });

  it('defaults to usable-only when the actor has no stored value', async () => {
    personalization.readPersonalization.mockResolvedValue(null);

    await useSettingsStore.getState().loadProviderPreferences();

    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(true);
  });

  it('persists the selected preference to the actor scope', async () => {
    await useSettingsStore.getState().setShowUsableOnly(false);

    expect(personalization.writePersonalization).toHaveBeenCalledWith(
      'settings.providers.showUsableOnly',
      false,
      null,
    );
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(false);
  });
});

describe('chat screenshot shortcut preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      showUsableProvidersOnly: true,
      chatScreenshotShortcut: 'Mod+Shift+A',
      error: null,
    });
    personalization.writePersonalization.mockResolvedValue(true);
    api.chatScreenshotShortcutRegister.mockResolvedValue({ ok: true });
  });

  it('registers the stored actor shortcut on load', async () => {
    personalization.readPersonalization.mockResolvedValue('Mod+Shift+S');

    await useSettingsStore.getState().loadChatPreferences();

    expect(personalization.readPersonalization).toHaveBeenCalledWith(
      'settings.chat.screenshotShortcut',
      null,
    );
    expect(useSettingsStore.getState().chatScreenshotShortcut).toBe('Mod+Shift+S');
    expect(api.chatScreenshotShortcutRegister).toHaveBeenCalledWith({
      shortcut: 'Mod+Shift+S',
    });
  });

  it('resets to identity-independent defaults', async () => {
    useSettingsStore.setState({
      chatScreenshotShortcut: 'Mod+Shift+S',
      showUsableProvidersOnly: false,
    });

    useSettingsStore.getState().resetPersonalization();
    await vi.waitFor(() => expect(api.chatScreenshotShortcutRegister).toHaveBeenCalled());

    const state = useSettingsStore.getState();
    expect(state.chatScreenshotShortcut).toBe('Mod+Shift+A');
    expect(state.showUsableProvidersOnly).toBe(true);
    expect(api.chatScreenshotShortcutRegister).toHaveBeenCalledWith({
      shortcut: 'Mod+Shift+A',
    });
  });

  it('discards a delayed preference read after reset, including its native effect', async () => {
    let resolve!: (value: unknown) => void;
    personalization.readPersonalization.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = useSettingsStore.getState().loadChatPreferences();
    useSettingsStore.getState().resetPersonalization();
    resolve('Mod+Shift+S');
    await pending;
    expect(useSettingsStore.getState().chatScreenshotShortcut).toBe('Mod+Shift+A');
    await vi.waitFor(() => expect(api.chatScreenshotShortcutRegister).toHaveBeenLastCalledWith({ shortcut: 'Mod+Shift+A' }));
  });

  it('discards delayed Station projection errors after reset', async () => {
    let reject!: (value: unknown) => void;
    api.listAgents.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    const pending = useSettingsStore.getState().loadAgents();
    useSettingsStore.getState().resetPersonalization();
    reject(new Error('actor A unavailable'));
    await pending;
    expect(useSettingsStore.getState()).toMatchObject({ agents: [], loading: false, error: null });
  });

  it('preserves a newer user choice when an older load finishes', async () => {
    let resolve!: (value: unknown) => void;
    personalization.readPersonalization.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const pending = useSettingsStore.getState().loadProviderPreferences();
    await useSettingsStore.getState().setShowUsableOnly(false);
    resolve(true);
    await pending;
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(false);
  });

  it('rejects the retired string boolean format', async () => {
    personalization.readPersonalization.mockResolvedValueOnce('false');
    await useSettingsStore.getState().loadProviderPreferences();
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(true);
    expect(useSettingsStore.getState().error).toBe('Invalid Provider display preference');
  });
});
