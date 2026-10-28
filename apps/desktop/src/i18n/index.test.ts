import { afterEach, describe, expect, it, vi } from 'vitest';

const personalization = vi.hoisted(() => ({
  writePersonalization: vi.fn(),
  readPersonalization: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

vi.mock('../runtimes/personalization', () => ({
  PERSONALIZATION_LANGUAGE_KEY: 'peers-touch-lang',
  writePersonalization: personalization.writePersonalization,
  readPersonalization: personalization.readPersonalization,
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
    personalization.writePersonalization.mockReset();
  });

  it('returns the i18next completion promise and persists as actor personalization', async () => {
    const completion = Promise.resolve(i18n.t);
    vi.spyOn(i18n, 'changeLanguage').mockReturnValue(completion);
    personalization.writePersonalization.mockResolvedValue(true);

    const result = changeLanguage('zh-CN');

    expect(result).toBe(completion);
    expect(personalization.writePersonalization).toHaveBeenCalledWith(
      'peers-touch-lang',
      'zh-CN',
    );
    await expect(result).resolves.toBe(i18n.t);
  });
});
