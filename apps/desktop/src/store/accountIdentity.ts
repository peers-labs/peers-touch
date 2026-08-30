import { createDesktopStore } from './createDesktopStore';
import { api, type AccountIdentity } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';

const initialState = {
  accounts: [] as AccountIdentity[],
  activeAccountId: undefined as string | undefined,
  loading: false,
  error: undefined as string | undefined,
};

interface AccountIdentityStore {
  accounts: AccountIdentity[];
  activeAccountId?: string;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
  unlockWithPin: (accountId: string, pin: string) => Promise<void>;
  reset: () => void;
  hydrate: (actorPtid: string) => Promise<void>;
}

let loadPromise: Promise<void> | null = null;

function accountsEqual(a: AccountIdentity[], b: AccountIdentity[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id
      || a[i].provider !== b[i].provider
      || a[i].provider_user_id !== b[i].provider_user_id
      || a[i].name !== b[i].name
      || a[i].email !== b[i].email
      || a[i].avatar_url !== b[i].avatar_url
      || a[i].avatar_local_path !== b[i].avatar_local_path
      || a[i].profile_url !== b[i].profile_url
      || a[i].created_at !== b[i].created_at
      || a[i].last_login_at !== b[i].last_login_at
      || a[i].has_pin !== b[i].has_pin
      || a[i].has_session !== b[i].has_session
    ) return false;
  }
  return true;
}

export const useAccountIdentityStore = createDesktopStore<AccountIdentityStore>('accountIdentity', (set, get) => ({
  ...initialState,

  reset: () => {
    loadPromise = null;
    set({ ...initialState });
  },

  hydrate: async (_actorPtid: string) => {
    await get().load();
  },

  load: async () => {
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      set({ loading: true, error: undefined });
      try {
        const [list, active] = await Promise.all([api.accountList(), api.accountGetActive()]);
        const newAccounts = list.accounts || [];
        const newActiveId = active?.id || list.active_account_id;
        const prev = get();
        const changed = !accountsEqual(prev.accounts, newAccounts)
          || prev.activeAccountId !== newActiveId;
        set({ accounts: newAccounts, activeAccountId: newActiveId, loading: false });
        if (changed) {
          eventBus.publish(EVENT.AUTH_IDENTITY_CHANGED, undefined);
        }
      } catch (error: any) {
        set({
          loading: false,
          error: error?.message || 'failed to load account identity',
        });
      } finally {
        loadPromise = null;
      }
    })();
    return loadPromise;
  },

  switchAccount: async (id: string) => {
    await api.accountSwitch(id);
    await get().load();
  },

  unlockWithPin: async (accountId: string, pin: string) => {
    await api.accountUnlock(accountId, pin);
    await get().load();
  },
}));
