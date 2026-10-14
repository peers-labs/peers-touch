import { createDesktopStore } from './createDesktopStore';
import { api, type NotificationPushDeviceData } from '../services/desktop_api';
import { currentAuthenticatedActorPtid, useSessionStore } from './session';
import { log } from '../utils/logger';

interface PushDevicesState {
  registrations: NotificationPushDeviceData[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  reset: () => void;
}

let readGeneration = 0;

function sessionKey(): string | null {
  const actorPtid = currentAuthenticatedActorPtid();
  return actorPtid ? `${actorPtid}\0${useSessionStore.getState().sessionEpoch}` : null;
}

export const usePushDevicesStore = createDesktopStore<PushDevicesState>('pushDevices', (set) => ({
  registrations: [],
  loading: false,
  error: null,
  reset: () => {
    readGeneration += 1;
    set({ registrations: [], loading: false, error: null });
  },
  refresh: async () => {
    const scope = sessionKey();
    if (!scope) return;
    const generation = ++readGeneration;
    set({ loading: true, error: null });
    try {
      const result = await api.notificationPushDevices();
      if (scope !== sessionKey() || generation !== readGeneration) return;
      const actorPtid = currentAuthenticatedActorPtid();
      if (result.registrations.some((registration) => registration.actorPtid !== actorPtid)) {
        throw new Error('Push registration belongs to a different actor');
      }
      set({ registrations: result.registrations, loading: false, error: null });
    } catch (error) {
      if (scope !== sessionKey() || generation !== readGeneration) return;
      log.warn('notification', 'Push device reconciliation failed', error);
      set({ loading: false, error: 'settings.notifications.devices.loadFailed' });
    }
  },
}));
