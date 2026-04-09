import { create } from 'zustand';
import { api, type AccountIdentity } from '../services/desktop_api';
import { EVENT, eventBus } from '../kernel/events';

interface AccountIdentityStore {
  accounts: AccountIdentity[];
  activeAccountId?: string;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
}

let loadPromise: Promise<void> | null = null;

function accountsEqual(a: AccountIdentity[], b: AccountIdentity[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].name !== b[i].name || a[i].avatar_url !== b[i].avatar_url) return false;
  }
  return true;
}

export const useAccountIdentityStore = create<AccountIdentityStore>((set, get) => ({
  accounts: [],
  activeAccountId: undefined,
  loading: false,
  error: undefined,

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
}));
