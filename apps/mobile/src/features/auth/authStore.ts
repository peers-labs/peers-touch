import { create } from 'zustand';

import type { AccessDecision, MobileAuthSession } from './authSession';

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
  hideAccessProjection: () => void;
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
  hideAccessProjection: () => set({
    accessDecision: null,
    loading: false,
    error: null,
    restored: false,
  }),
  hideSessionProjection: () => set({ session: null }),

  clearSession: async () => {
    set({ session: null });
  },
}));
