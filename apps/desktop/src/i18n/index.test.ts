import { afterEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => ({
  writeDesktopPreferenceSync: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../storage/desktopClientStorage', () => ({
  readDesktopPreferenceSync: vi.fn(() => null),
  writeDesktopPreferenceSync: storage.writeDesktopPreferenceSync,
}));

vi.mock('../utils/logger', () => ({
  log: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import i18n, { changeLanguage } from './index';

describe('changeLanguage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    storage.writeDesktopPreferenceSync.mockReset();
  });

  it('returns the i18next completion promise', async () => {
    const completion = Promise.resolve(i18n.t);
    vi.spyOn(i18n, 'changeLanguage').mockReturnValue(completion);

    const result = changeLanguage('zh-CN');

    expect(result).toBe(completion);
    expect(storage.writeDesktopPreferenceSync).toHaveBeenCalledWith(
      'peers-touch-lang',
      'zh-CN',
    );
    await expect(result).resolves.toBe(i18n.t);
  });
});
