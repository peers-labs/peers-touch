// Station connection projection store.
//
// Single read model for "which Station am I bound to, and is the realtime
// channel connected". It hydrates from `station_list` once and stays current
// through kernel events instead of polling:
//   - station.active_changed      → active station identity changed
//   - realtime.connection_state   → realtime channel connected/ended
//
// Chat surfaces (the header station chip) and any other identity-bearing UI
// render from this store instead of faking an "unavailable" state from a
// missing conversation field.

import { createDesktopStore } from './createDesktopStore';
import { api } from '../services/desktop_api';
import { isRawStationAuthority } from './federation';
import { eventBus } from '../kernel/events/bus';
import { EVENT } from '../kernel/events/catalog';
import { log } from '../utils/logger';

export interface StationConnectionState {
  /** True after the first station_list hydration. */
  initialized: boolean;
  activeStationPeerId: string;
  /** Human station display name; empty when the Station reports none. */
  activeStationName: string;
  bindingPhase: string;
  /** Realtime channel connectivity as reported by the event stream. */
  realtimeConnected: boolean;
  refresh: () => Promise<void>;
}

function humanStationName(rawName: string | null | undefined): string {
  const name = (rawName ?? '').trim();
  return name && !isRawStationAuthority(name) ? name : '';
}

export type StationChipState = 'connected' | 'disconnected' | 'neutral';

export interface StationChipModel {
  stationId: string;
  label: string;
  state: StationChipState;
}

/**
 * Resolve the conversation header station chip.
 *
 * - Local groups are hosted on the user's own bound Station: show its human
 *   name with live realtime connectivity; hide until the first hydration.
 * - Federated direct chats show the peer authority station only when a human
 *   name is known. Reachability toward that peer is already expressed by the
 *   presence dot next to the title, so the chip stays neutral — never a fake
 *   "unavailable" derived from a missing id.
 */
export function resolveConversationStationChip(input: {
  kind: 'friend' | 'group';
  authorityStationId: string;
  authorityStationName: string;
  localStation: {
    initialized: boolean;
    peerId: string;
    name: string;
    realtimeConnected: boolean;
  };
}): StationChipModel | null {
  if (input.kind === 'group') {
    const { localStation } = input;
    // Require a human name: a bare PeerID is routing data, not a label.
    if (!localStation.initialized || !localStation.name) return null;
    return {
      stationId: localStation.peerId,
      label: localStation.name,
      state: localStation.realtimeConnected ? 'connected' : 'disconnected',
    };
  }
  if (!input.authorityStationName) return null;
  return {
    stationId: input.authorityStationId,
    label: input.authorityStationName,
    state: 'neutral',
  };
}

let hydrating = false;

export const useStationConnectionStore = createDesktopStore<StationConnectionState>(
  'stationConnection',
  (set) => ({
    initialized: false,
    activeStationPeerId: '',
    activeStationName: '',
    bindingPhase: '',
    realtimeConnected: false,

    refresh: async () => {
      if (hydrating) return;
      hydrating = true;
      try {
        const result = await api.stationList();
        const activeId = result.active_station_peer_id?.trim()
          || result.binding?.station_peer_id?.trim()
          || '';
        const activeEntry = (result.entries ?? []).find(
          (entry) => entry.station_peer_id === activeId,
        );
        set({
          initialized: true,
          activeStationPeerId: activeId,
          activeStationName: humanStationName(activeEntry?.display_name),
          bindingPhase: result.binding?.phase ?? '',
        });
      } catch (error) {
        log.warn('stationConnection', 'station list hydration failed', { error });
        set({ initialized: true });
      } finally {
        hydrating = false;
      }
    },
  }),
);

let subscribed = false;

/**
 * Wire kernel events into the store and run the first hydration. Safe to call
 * repeatedly; the subscription is process-singleton.
 */
export function initStationConnectionStore(): () => void {
  const refresh = () => {
    void useStationConnectionStore.getState().refresh();
  };
  if (!subscribed) {
    subscribed = true;
    const unsubscribers = [
      eventBus.subscribe(EVENT.STATION_ACTIVE_CHANGED, (payload) => {
        // Reflect the switch immediately, then reconcile the registry entry.
        setStationActive(payload.stationPeerId, humanStationName(payload.displayName));
        refresh();
      }),
      eventBus.subscribe(EVENT.REALTIME_CONNECTION_STATE, (payload) => {
        useStationConnectionStore.setState({ realtimeConnected: Boolean(payload.connected) });
      }),
    ];
    refresh();
    return () => {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      subscribed = false;
    };
  }
  return () => {};
}

function setStationActive(stationPeerId: string, displayName: string): void {
  useStationConnectionStore.setState((state) => ({
    activeStationPeerId: stationPeerId,
    activeStationName: displayName || state.activeStationName,
  }));
}
