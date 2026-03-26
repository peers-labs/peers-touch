import { create } from 'zustand';
import { api, type AccountIdentity } from '../services/desktop_api';

interface AccountIdentityStore {
  accounts: AccountIdentity[];
  activeAccountId?: string;
  loading: boolean;
  error?: string;
  load: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
}

let loadPromise: Promise<void> | null = null;

function notifyChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('account-identity-changed'));
  }
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
        set({
          accounts: list.accounts || [],
          activeAccountId: active?.id || list.active_account_id,
          loading: false,
        });
      } catch (error: any) {
        set({
          loading: false,
          error: error?.message || 'failed to load account identity',
        });
      } finally {
        loadPromise = null;
      }
      notifyChanged();
    })();
    return loadPromise;
  },

  switchAccount: async (id: string) => {
    await api.accountSwitch(id);
    await get().load();
  },
}));
