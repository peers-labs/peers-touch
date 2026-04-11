/**
 * Dashboard overview state management via Zustand.
 * Manages loading and caching of overview statistics and recent activity data.
 */

import { create } from 'zustand';
import * as overviewApi from '../api/overview';
import { log } from '../utils/logger';

interface DashboardState {
  stats: overviewApi.OverviewStats | null;
  loading: boolean;
  recentActors: unknown[];
  recentAuditLogs: unknown[];

  loadStats: () => Promise<void>;
  loadRecentActors: () => Promise<void>;
  loadRecentAuditLogs: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  stats: null,
  loading: false,
  recentActors: [],
  recentAuditLogs: [],

  loadStats: async () => {
    set({ loading: true });
    try {
      const stats = await overviewApi.getOverviewStats();
      set({ stats, loading: false });
    } catch (err) {
      log.error('dashboard', 'Failed to load stats', { error: String(err) });
      set({ loading: false });
    }
  },

  loadRecentActors: async () => {
    try {
      const items = await overviewApi.getRecentActors(10);
      set({ recentActors: items });
    } catch (err) {
      log.error('dashboard', 'Failed to load recent actors', { error: String(err) });
    }
  },

  loadRecentAuditLogs: async () => {
    try {
      const items = await overviewApi.getRecentAuditLogs(10);
      set({ recentAuditLogs: items });
    } catch (err) {
      log.error('dashboard', 'Failed to load recent audit logs', { error: String(err) });
    }
  },
}));
