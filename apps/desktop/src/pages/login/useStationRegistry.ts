// Single read/write model for the local Station registry on the auth surface.
//
// Both the inline first-run Station card and the gear popover consume this so
// the gate stage machine and the configuration UI share one data source
// instead of each issuing their own station_list calls.

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { api } from '../../services/desktop_api';
import type {
  StationEntry,
  StationRouteCandidate,
  StationRouteHealth,
} from '../../services/desktop_api';
import { markStationUserChoice } from '../../services/stationDefault';
import { log } from '../../utils/logger';

export type StationHealthStatus = 'unknown' | 'checking' | 'online' | 'offline';

export interface AddFeedback {
  tone: 'success' | 'danger';
  text: string;
}

export interface UseStationRegistryOptions {
  /**
   * Fired with the latest entries whenever the registry changes (load, add,
   * remove, switch). The parent gate uses it to detect when a Station becomes
   * available and advance past the Station setup stage.
   */
  onEntriesChange?: (entries: StationEntry[]) => void;
}

export function useStationRegistry(options: UseStationRegistryOptions = {}) {
  const { t } = useTranslation('common');
  const [entries, setEntries] = useState<StationEntry[]>([]);
  const [activeStationPeerId, setActiveStationPeerId] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<AddFeedback | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const loadStations = useCallback(async () => {
    try {
      const result = await api.stationList();
      const nextEntries = result.entries ?? [];
      setEntries(nextEntries);
      setActiveStationPeerId(result.active_station_peer_id ?? '');
      options.onEntriesChange?.(nextEntries);
    } catch (error) {
      log.warn('useStationRegistry', 'Failed to load Station registry', { error });
    } finally {
      setHydrated(true);
    }
    // onEntriesChange is an event sink intentionally excluded from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  const selectRoute = useCallback(
    async (entry: StationEntry, route: StationRouteCandidate) => {
      const current = entries.find(
        (candidate) => candidate.station_peer_id === activeStationPeerId,
      );
      if (
        current
        && current.station_peer_id !== entry.station_peer_id
        && !window.confirm(t('common.stationPicker.confirmStationChange'))
      ) {
        return;
      }
      try {
        const result = await api.stationSetActive(entry.station_peer_id, route.route_id);
        markStationUserChoice();
        const nextActive = result.active_station_peer_id ?? entry.station_peer_id;
        setActiveStationPeerId(nextActive);
        setEntries((currentEntries) => {
          const nextEntries = currentEntries.map((candidate) =>
            candidate.station_peer_id === entry.station_peer_id
              ? {
                  ...candidate,
                  active_route_id: result.active_route_id ?? route.route_id,
                  route_revision: result.binding.route_revision,
                  lifecycle_generation: result.binding.lifecycle_generation,
                }
              : candidate,
          );
          options.onEntriesChange?.(nextEntries);
          return nextEntries;
        });
      } catch (error) {
        log.error('useStationRegistry', 'Failed to select Station', {
          stationPeerId: entry.station_peer_id,
          routeId: route.route_id,
          error,
        });
      }
    },
    [activeStationPeerId, entries, options, t],
  );

  const handleAdd = useCallback(async () => {
    const input = inputValue.trim();
    if (!input || adding) return;
    setAdding(true);
    setFeedback(null);
    try {
      const discovered = await api.stationAdd(input);
      const discoveredEntry = discovered.entries[0];
      const alreadyKnown = discoveredEntry
        ? entries.some(
            (candidate) => candidate.station_peer_id === discoveredEntry.station_peer_id,
          )
        : false;
      setInputValue('');
      await loadStations();
      if (
        discovered.entries.length === 1
        && discovered.entries[0]?.routes.length === 1
      ) {
        const entry = discovered.entries[0];
        const route = entry.routes[0];
        if (entry && route) {
          await selectRoute(entry, route);
        }
      }
      setFeedback({
        tone: 'success',
        text: alreadyKnown
          ? t('common.stationPicker.addAlreadyPresent')
          : t('common.stationPicker.addSuccess'),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : '';
      setFeedback({
        tone: 'danger',
        text: detail
          ? t('common.stationPicker.addFailedWithReason', { reason: detail })
          : t('common.stationPicker.addFailed'),
      });
    } finally {
      setAdding(false);
    }
  }, [adding, entries, loadStations, selectRoute, t]);

  const handleRemove = useCallback(
    async (entry: StationEntry) => {
      markStationUserChoice();
      try {
        await api.stationRemove(entry.station_peer_id);
        await loadStations();
      } catch (error) {
        log.error('useStationRegistry', 'Failed to remove Station', {
          stationPeerId: entry.station_peer_id,
          error,
        });
      }
    },
    [loadStations],
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const activeEntry =
    entries.find((entry) => entry.station_peer_id === activeStationPeerId)
    ?? (entries.length === 1 ? entries[0] : undefined);
  const activeRoute = activeEntry ? routeOf(activeEntry) : undefined;
  const activeStatus = statusFromRoute(activeRoute);
  const activeLabel =
    activeEntry?.display_name
    || shortPeerId(activeEntry?.station_peer_id)
    || t('common.stationPicker.fallbackLabel');

  return {
    hydrated,
    entries,
    hasStation: entries.length > 0,
    activeStationPeerId,
    activeStatus,
    activeLabel,
    inputValue,
    setInputValue,
    adding,
    feedback,
    loadStations,
    selectRoute,
    handleAdd,
    handleRemove,
    clearFeedback,
  };
}

function routeOf(entry: StationEntry): StationRouteCandidate | undefined {
  return entry.routes.find((route) => route.route_id === entry.active_route_id);
}

function statusFromRoute(route?: StationRouteCandidate): StationHealthStatus {
  if (!route) return 'unknown';
  const mapping: Record<StationRouteHealth, StationHealthStatus> = {
    available: 'online',
    degraded: 'offline',
    unavailable: 'offline',
    revoked: 'offline',
  };
  return mapping[route.health];
}

function shortPeerId(value?: string): string {
  const peerId = value?.trim() ?? '';
  if (peerId.length <= 22) return peerId;
  return `${peerId.slice(0, 10)}...${peerId.slice(-8)}`;
}
