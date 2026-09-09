import { create } from 'zustand';

import {
  clearAuthSession,
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
  setSession: (session: MobileAuthSession | null) => void;
  setAccessDecision: (decision: AccessDecision | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setRestored: (restored: boolean) => void;
  hideSessionProjection: () => void;
  clearSession: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  accessDecision: null,
  loading: false,
  error: null,
  restored: false,

  setSession: (session) => set({ session }),
  setAccessDecision: (accessDecision) => set({ accessDecision }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setRestored: (restored) => set({ restored }),
  hideSessionProjection: () => set({
    session: null,
    accessDecision: null,
    loading: false,
    error: null,
  }),

  clearSession: async () => {
    set({
      session: null,
      accessDecision: null,
      loading: false,
      error: null,
    });
    try {
      await clearAuthSession();
    } catch (error) {
      set({ error: errorMessage(error) });
      throw error;
    }
  },
}));

function errorMessage(error: unknown): string {
  return readableErrorMessage(error);
}
