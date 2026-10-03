export function normalizeAccountLoginProvider(provider?: string | null): string {
  const normalized = provider?.trim().toLowerCase() ?? '';
  if (normalized === 'password' || normalized === 'local') return 'local';
  return normalized;
}

export function resolveAccountLoginProvider({
  accountProvider,
  sessionProvider,
  loginMethod,
}: {
  accountProvider?: string | null;
  sessionProvider?: string | null;
  loginMethod?: string | null;
}): string {
  const provider = [accountProvider, sessionProvider, loginMethod].find(
    (candidate) => Boolean(candidate?.trim()),
  );
  return normalizeAccountLoginProvider(provider);
}

export function accountLoginProviderLocaleKey(
  provider?: string | null,
):
  | 'provider.account.identity.loginProviderLocal'
  | 'provider.account.identity.loginProviderGitHub'
  | 'provider.account.identity.loginProviderGoogle'
  | null {
  switch (normalizeAccountLoginProvider(provider)) {
    case 'local':
      return 'provider.account.identity.loginProviderLocal';
    case 'github':
      return 'provider.account.identity.loginProviderGitHub';
    case 'google':
      return 'provider.account.identity.loginProviderGoogle';
    default:
      return null;
  }
}
