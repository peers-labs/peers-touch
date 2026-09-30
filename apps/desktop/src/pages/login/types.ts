import type { AccountIdentity, OAuth2ProviderSummary } from '../../services/desktop_api';

export type LoginState = 'logged_out' | 'welcome_back' | 'account_picker' | 'pin_entry' | 'relink_pin' | 'set_pin' | 'pin_recovery_auth' | 'pin_recovery_new_pin';
export type LoginTab = 'quick' | 'email';
export type AuthState = 'idle' | 'opening' | 'waiting' | 'initializing' | 'success' | 'error';

export interface SessionUser {
  name: string;
  email?: string;
  avatar?: string;
  accountId?: string;
  hasPin?: boolean;
  hasSession?: boolean;
  provider?: string;
}

export function accountIdentityToSessionUser(account: AccountIdentity): SessionUser {
  return {
    name: account.name || account.provider_user_id || 'User',
    email: account.email || '',
    avatar: account.avatar_url || undefined,
    accountId: account.id,
    hasPin: account.has_pin,
    hasSession: account.has_session,
    provider: account.provider,
  };
}

export type { OAuth2ProviderSummary };
