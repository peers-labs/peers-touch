import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({ api }));
vi.mock('../services/tool-service', () => ({
  toolService: { list: vi.fn() },
}));

import { useSettingsStore } from './settings';

describe('provider display preference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      showUsableProvidersOnly: true,
      error: null,
    });
  });

  it('loads the persisted preference', async () => {
    api.settingsGet.mockResolvedValue({
      ok: true,
      data: { value: 'false' },
    });

    await useSettingsStore.getState().loadProviderPreferences();

    expect(api.settingsGet).toHaveBeenCalledWith({
      key: 'settings.providers.showUsableOnly',
    });
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(false);
  });

  it('persists the selected preference', async () => {
    api.settingsSet.mockResolvedValue({ ok: true });

    await useSettingsStore.getState().setShowUsableProvidersOnly(false);

    expect(api.settingsSet).toHaveBeenCalledWith({
      key: 'settings.providers.showUsableOnly',
      value: false,
    });
    expect(useSettingsStore.getState().showUsableProvidersOnly).toBe(false);
  });
});
