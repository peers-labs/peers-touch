import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileI18nProvider, useMobileI18n } from './mobileI18n';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MobileI18nProvider', () => {
  it('loads the Moments namespace used by Mobile social surfaces', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });

    const markup = renderToStaticMarkup(
      <MobileI18nProvider>
        <MomentsTranslations />
      </MobileI18nProvider>,
    );

    expect(markup).toContain('Post deleted');
    expect(markup).toContain('Reply');
    expect(markup).toContain('Delete');
    expect(markup).not.toContain('moments.');
  });

  it('loads the Chinese Moments namespace', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });

    const markup = renderToStaticMarkup(
      <MobileI18nProvider>
        <MomentsTranslations />
      </MobileI18nProvider>,
    );

    expect(markup).toContain('动态已删除');
    expect(markup).toContain('回复');
    expect(markup).toContain('删除');
    expect(markup).not.toContain('moments.');
  });

  it.each([
    ['en-US', ['Incoming call', 'Connected', 'Call ended', 'Mute microphone']],
    ['zh-CN', ['来电', '通话中', '通话已结束', '麦克风静音']],
  ])('loads call controls and lifecycle states for %s', (language, expected) => {
    vi.stubGlobal('navigator', { language });

    const markup = renderToStaticMarkup(
      <MobileI18nProvider>
        <CallTranslations />
      </MobileI18nProvider>,
    );

    expected.forEach((translation) => expect(markup).toContain(translation));
    expect(markup).not.toContain('mobile.call.');
  });
});

function MomentsTranslations() {
  const { t } = useMobileI18n();

  return (
    <div>
      <span>{t('moments.private.revocation.RESOURCE_DELETED.title')}</span>
      <span>{t('moments.comment.reply')}</span>
      <span>{t('moments.comment.delete')}</span>
    </div>
  );
}

function CallTranslations() {
  const { t } = useMobileI18n();

  return (
    <div>
      <span>{t('mobile.call.state.ringing_all_devices')}</span>
      <span>{t('mobile.call.state.active_here')}</span>
      <span>{t('mobile.call.state.ended')}</span>
      <span>{t('mobile.call.mute')}</span>
    </div>
  );
}
