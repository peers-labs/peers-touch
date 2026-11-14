import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MobileI18nProvider,
  mobileErrorKey,
  translateMobileError,
  useMobileI18n,
} from './mobileI18n';

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
});

describe('mobile error translation', () => {
  it('extracts the stable locale key from native key:detail strings', () => {
    expect(mobileErrorKey('mobile.auth.oauthStationRejected:404'))
      .toBe('mobile.auth.oauthStationRejected');
    expect(mobileErrorKey('mobile.auth.oauthTransportUnavailable:dns error'))
      .toBe('mobile.auth.oauthTransportUnavailable');
    expect(mobileErrorKey('mobile.auth.sessionExpired')).toBe('mobile.auth.sessionExpired');
    expect(mobileErrorKey('plain network error')).toBeNull();
    expect(mobileErrorKey(null)).toBeNull();
  });

  it('never surfaces a raw key or transport detail', () => {
    vi.stubGlobal('navigator', { language: 'en-US' });
    let translate!: (key: string) => string;
    renderToStaticMarkup(
      <MobileI18nProvider>
        <CaptureTranslate onReady={(t) => { translate = t; }} />
      </MobileI18nProvider>,
    );

    // Known key with a diagnostic suffix: translated, suffix hidden.
    expect(translateMobileError(
      translate, 'mobile.auth.oauthStationRejected:404', 'mobile.auth.loginFailed',
    )).toBe(
      'The Station rejected third-party sign-in. This provider may not be configured on the Station',
    );
    // Unknown key: human fallback instead of the raw string.
    expect(translateMobileError(translate, 'mobile.auth.unknownKey:boom', 'mobile.auth.loginFailed'))
      .toBe('Login failed. Check your email and password');
    // Empty error: fallback.
    expect(translateMobileError(translate, '', 'mobile.auth.loginFailed'))
      .toBe('Login failed. Check your email and password');
  });
});

function CaptureTranslate({ onReady }: { onReady: (t: (key: string) => string) => void }) {
  onReady(useMobileI18n().t);
  return null;
}

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
