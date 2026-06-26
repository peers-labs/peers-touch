import { create } from 'zustand';

import {
  clearAuthSession,
  restoreAuthSession,
  type AccessDecision,
  type MobileAuthSession,
} from './authSession';
import { readableErrorMessage } from '../../utils/errorMessage';

interface AuthState {
  session: MobileAuthSession | null;
  accessDecision: AccessDecision | null;
  loading: boolean;
  error: string | null;
  restored: boolean;
  restoreSession: () => Promise<MobileAuthSession | null>;
  setSession: (session: MobileAuthSession | null) => void;
  setAccessDecision: (decision: AccessDecision | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  accessDecision: null,
  loading: false,
  error: null,
  restored: false,

  restoreSession: async () => {
    try {
      const session = await restoreAuthSession();
      set({ session, restored: true, error: null });
      return session;
    } catch (error) {
      set({ session: null, restored: true, error: errorMessage(error) });
      return null;
    }
  },

  setSession: (session) => set({ session }),
  setAccessDecision: (accessDecision) => set({ accessDecision }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),

  clearSession: async () => {
    await clearAuthSession();
    set({ session: null, accessDecision: null, error: null });
  },
}));

function errorMessage(error: unknown): string {
  return readableErrorMessage(error);
}
