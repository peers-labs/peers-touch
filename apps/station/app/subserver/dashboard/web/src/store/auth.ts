/**
 * Authentication state management via Zustand.
 * Handles login/logout flow, token persistence, and session validation.
 */

import { create } from 'zustand';
import * as authApi from '../api/auth';
import { getAuthToken, setAuthToken } from '../api/client';
import { log } from '../utils/logger';

interface AuthState {
  admin: authApi.AdminInfo | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;

  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  admin: null,
  loading: false,
  error: null,
  isAuthenticated: false,

  login: async (username, password) => {
    set({ loading: true, error: null });
    try {
      const result = await authApi.login({ username, password });
      set({
        admin: result.admin,
        isAuthenticated: true,
        loading: false,
      });
      log.info('auth', 'Login successful', { username });
      return true;
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Login failed';
      set({ error: message, loading: false });
      return false;
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors — token may already be invalid
    }
    setAuthToken(null);
    set({ admin: null, isAuthenticated: false });
  },

  checkAuth: async () => {
    const token = getAuthToken();
    if (!token) {
      set({ isAuthenticated: false, admin: null });
      return false;
    }
    try {
      const admin = await authApi.getMe();
      set({ admin, isAuthenticated: true });
      return true;
    } catch {
      setAuthToken(null);
      set({ isAuthenticated: false, admin: null });
      return false;
    }
  },

  clearError: () => set({ error: null }),
}));
