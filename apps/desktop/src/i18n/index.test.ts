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
  capturePersonalizationScope: () => null,
  isPersonalizationScopeCurrent: () => true,
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

  it('persists actor personalization before applying the language', async () => {
    const completion = Promise.resolve(i18n.t);
    vi.spyOn(i18n, 'changeLanguage').mockReturnValue(completion);
    personalization.writePersonalization.mockResolvedValue(true);

    const result = changeLanguage('zh-CN');

    expect(personalization.writePersonalization).toHaveBeenCalledWith(
      'peers-touch-lang',
      'zh-CN',
      null,
    );
    await result;
    expect(i18n.changeLanguage).toHaveBeenCalledWith('zh-CN');
  });
});
