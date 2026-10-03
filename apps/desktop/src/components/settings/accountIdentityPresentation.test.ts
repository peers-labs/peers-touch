import { describe, expect, it } from 'vitest';

import {
  accountLoginProviderLocaleKey,
  normalizeAccountLoginProvider,
  resolveAccountLoginProvider,
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

  it('falls back to authenticated session provenance while the account projection loads', () => {
    expect(resolveAccountLoginProvider({
      accountProvider: '',
      sessionProvider: 'github',
      loginMethod: 'oauth',
    })).toBe('github');
    expect(resolveAccountLoginProvider({
      accountProvider: 'google',
      sessionProvider: 'github',
      loginMethod: 'oauth',
    })).toBe('google');
    expect(resolveAccountLoginProvider({
      loginMethod: 'password',
    })).toBe('local');
  });
});
