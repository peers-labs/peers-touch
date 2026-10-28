import { beforeEach, describe, expect, it, vi } from 'vitest';

const personalization = vi.hoisted(() => ({
  readPersonalization: vi.fn(),
  writePersonalization: vi.fn(),
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
    );
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(false);
  });
});

describe('chat screenshot shortcut preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalization.writePersonalization.mockResolvedValue(true);
    api.chatScreenshotShortcutRegister.mockResolvedValue({ ok: true });
  });

  it('registers the stored actor shortcut on load', async () => {
    personalization.readPersonalization.mockResolvedValue('Mod+Shift+S');

    await useSettingsStore.getState().loadChatPreferences();

    expect(personalization.readPersonalization).toHaveBeenCalledWith(
      'settings.chat.screenshotShortcut',
    );
    expect(useSettingsStore.getState().chatScreenshotShortcut).toBe('Mod+Shift+S');
    expect(api.chatScreenshotShortcutRegister).toHaveBeenCalledWith({
      shortcut: 'Mod+Shift+S',
    });
  });

  it('resets to identity-independent defaults', () => {
    useSettingsStore.setState({
      chatScreenshotShortcut: 'Mod+Shift+S',
      showUsableProvidersOnly: false,
    });

    useSettingsStore.getState().resetPersonalization();

    const state = useSettingsStore.getState();
    expect(state.chatScreenshotShortcut).toBe('Mod+Shift+A');
    expect(state.showUsableProvidersOnly).toBe(true);
    expect(api.chatScreenshotShortcutRegister).toHaveBeenCalledWith({
      shortcut: 'Mod+Shift+A',
    });
  });
});
