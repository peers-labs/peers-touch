import { createDesktopStore } from './createDesktopStore';
import { api, type StationEntry } from '../services/desktop_api';
import { log } from '../utils/logger';

// stationGate owns the single prerequisite for login: a reachable Station.
// Authentication proves identity *to a Station*, so login controls stay
// disabled until an active Station probes online. Both the login card and
// the Station picker read/refresh this state so the flow has one source of
// truth instead of letting a login click fail after the fact.

type GateStatus = 'loading' | 'ready' | 'unbound' | 'offline';

interface StationGateState {
  status: GateStatus;
  activeUrl: string;
  activeLabel: string;
  entries: StationEntry[];
  refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useStationGate = createDesktopStore<StationGateState>(
  'stationGate',
  (set) => {
    const refresh = () => {
      // Coalesce overlapping refreshes (picker change + card mount).
      if (inflight) return inflight;

      inflight = (async () => {
        try {
          const list = await api.stationList();
          const entries = list.entries ?? [];
          const activeUrl = list.active_url ?? '';

          if (!activeUrl) {
            set({ status: 'unbound', activeUrl: '', activeLabel: '', entries });
            return;
          }

          set({ status: 'loading', activeUrl, entries });
          const probe = await api.stationProbe(activeUrl);

          if (!probe.online) {
            set({ status: 'offline', activeUrl, entries });
            return;
          }

          const activeEntry = entries.find((e) => e.url === activeUrl);
          set({
            status: 'ready',
            activeUrl,
            activeLabel: activeEntry?.label || probe.label || '',
            entries,
          });
        } catch (error) {
          log.warn('stationGate', 'failed to evaluate station readiness', { error });
          set({ status: 'offline', activeUrl: '', activeLabel: '', entries: [] });
        } finally {
          inflight = null;
        }
      })();

      return inflight;
    };

    return {
      status: 'loading',
      activeUrl: '',
      activeLabel: '',
      entries: [],
      refresh,
    };
  },
);
