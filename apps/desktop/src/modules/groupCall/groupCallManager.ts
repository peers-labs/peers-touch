import { GroupCallController, GroupCallReplayProbe, createLivekitProvider } from '@peers-touch/client-chat-core/group-call';
import { api } from '../../services/desktop_api';
import { eventBus } from '../../kernel/events/bus';
import { EVENT } from '../../kernel/events/catalog';
import { desktopMediaReservation } from '../p2p/mediaReservation';

/** Host ports only: shared controller owns connection, tracks and cleanup. */
export const groupCallAdmissionProbe = new GroupCallReplayProbe(createLivekitProvider);
export const groupCallManager = new GroupCallController({
  reservation: desktopMediaReservation,
  createProvider: async () => {
    const provider = await createLivekitProvider();
    groupCallAdmissionProbe.observe(provider);
    return provider;
  },
  join: async (groupUlid, signal) => {
    const grant = await api.groupCallJoin({ group_ulid: groupUlid });
    if (signal.aborted) throw new DOMException('Call canceled', 'AbortError');
    groupCallAdmissionProbe.capture(grant);
    return grant;
  },
  iceServers: async (signal) => {
    const config = await api.iceGetServers();
    if (signal.aborted) throw new DOMException('Call canceled', 'AbortError');
    return (config as { ice_servers?: RTCIceServer[] }).ice_servers ?? [];
  },
});

eventBus.subscribe(EVENT.REALTIME_CALL_SIGNAL, (payload) => {
  const value = payload as unknown as {
    kind?: number | string; group_ulid?: string; groupUlid?: string;
    room_name?: string; roomName?: string;
  };
  const groupUlid = value.group_ulid ?? value.groupUlid;
  const roomName = value.room_name ?? value.roomName;
  if (!groupUlid || !roomName) return;
  const kind = value.kind === 9 || value.kind === 'ROOM_ACTIVE' ? 'room_active'
    : value.kind === 10 || value.kind === 'ROOM_ENDED' ? 'room_ended' : null;
  if (kind) groupCallManager.ingestRoomEvent({ kind, groupUlid, roomName });
});
