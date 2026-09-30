import { describe, expect, it } from 'vitest';

import {
  accountLoginProviderLocaleKey,
  normalizeAccountLoginProvider,
} from './accountIdentityPresentation';

describe('Account identity presentation', () => {
  it.each([
    ['password', 'local', 'provider.account.identity.loginProviderLocal'],
    ['local', 'local', 'provider.account.identity.loginProviderLocal'],
    ['GitHub', 'github', 'provider.account.identity.loginProviderGitHub'],
    ['google', 'google', 'provider.account.identity.loginProviderGoogle'],
  ])('maps %s to its stable sign-in source', (input, provider, localeKey) => {
    expect(normalizeAccountLoginProvider(input)).toBe(provider);
    expect(accountLoginProviderLocaleKey(input)).toBe(localeKey);
  });

  it('preserves an unknown provider id without inventing a label', () => {
    expect(normalizeAccountLoginProvider(' enterprise-sso ')).toBe('enterprise-sso');
    expect(accountLoginProviderLocaleKey('enterprise-sso')).toBeNull();
  });
});
