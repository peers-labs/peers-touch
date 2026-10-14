import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPushDeviceData } from '../services/desktop_api';

const api = vi.hoisted(() => ({ notificationPushDevices: vi.fn() }));
const session = vi.hoisted(() => ({ actorPtid: 'ptid:self', sessionEpoch: 1 }));
vi.mock('../services/desktop_api', () => ({ api }));
vi.mock('./session', () => ({
  currentAuthenticatedActorPtid: () => session.actorPtid,
  useSessionStore: { getState: () => session },
}));
import { usePushDevicesStore } from './pushDevices';

const device: NotificationPushDeviceData = {
  registrationId: 'registration', actorPtid: 'ptid:self', deviceId: 'mobile',
  channel: 1, environment: 2, createdAt: null, updatedAt: null, lastSuccessAt: null,
};

describe('push device projection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    session.sessionEpoch = 1;
    usePushDevicesStore.getState().reset();
  });

  it('reads only Station registrations for the current actor', async () => {
    api.notificationPushDevices.mockResolvedValue({ registrations: [device] });
    await usePushDevicesStore.getState().refresh();
    expect(usePushDevicesStore.getState().registrations).toEqual([device]);
  });

  it('drops delayed responses after the same actor starts a new session', async () => {
    let complete!: (value: { registrations: NotificationPushDeviceData[] }) => void;
    api.notificationPushDevices.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const pending = usePushDevicesStore.getState().refresh();
    session.sessionEpoch += 1;
    usePushDevicesStore.getState().reset();
    complete({ registrations: [device] });
    await pending;
    expect(usePushDevicesStore.getState().registrations).toEqual([]);
  });

  it('retains known data while exposing a retryable read failure', async () => {
    usePushDevicesStore.setState({ registrations: [device] });
    api.notificationPushDevices.mockRejectedValue(new Error('offline'));
    await usePushDevicesStore.getState().refresh();
    expect(usePushDevicesStore.getState()).toMatchObject({
      registrations: [device], loading: false, error: 'settings.notifications.devices.loadFailed',
    });
  });

  it('rejects another actor instead of rendering their registration', async () => {
    api.notificationPushDevices.mockResolvedValue({
      registrations: [{ ...device, actorPtid: 'ptid:other' }],
    });
    await usePushDevicesStore.getState().refresh();
    expect(usePushDevicesStore.getState().registrations).toEqual([]);
    expect(usePushDevicesStore.getState().error).not.toBeNull();
  });
});
