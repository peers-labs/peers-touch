import {
  GroupCallController, createLivekitProvider, groupCallErrorCode,
  type GroupCallJoinResponse, type GroupCallRoomEvent,
} from '@peers-touch/client-chat-core/group-call';
import type { MobileAuthSession } from '../auth/authSession';
import type { RealtimeWireEvent } from '../social/socialWire';
import { useSocialStore } from '../social/socialStore';
import { executeStationOperation, responseJson } from '../../services/stationTransport';
import { mobileMediaReservation } from './mediaReservation';

let session: MobileAuthSession | null = null;
const roomListeners = new Set<() => void>();
export interface MobileGroupRoom {
  readonly groupUlid: string;
  readonly roomName: string;
  readonly roomSID: string;
  readonly declinedActorPtids: readonly string[];
}
let rooms: ReadonlyMap<string, MobileGroupRoom> = new Map();
let dismissed = new Set<string>();
let sessionAbort = new AbortController();
let unsubscribeGroups: (() => void) | undefined;
const pendingStatus = new Map<string, Promise<void>>();
const dirtyStatus = new Set<string>();
let rosterActors = '';

function requireSession(): MobileAuthSession {
  if (!session) throw new Error('call.sessionUnavailable');
  return session;
}

export const mobileGroupCallManager = new GroupCallController({
  reservation: mobileMediaReservation,
  createProvider: createLivekitProvider,
  join: async (groupUlid, signal) => {
    const current = requireSession();
    const response = await executeStationOperation(current, {
      operationId: 'group_call_join', group_ulid: groupUlid,
    }, signal);
    if (response.status < 200 || response.status >= 300) {
      throw Object.assign(new Error('call.joinFailed'), { status: response.status });
    }
    return responseJson(response) as GroupCallJoinResponse;
  },
  iceServers: async (signal) => {
    const response = await executeStationOperation(requireSession(), {
      operationId: 'turn_ice_servers',
    }, signal);
    if (response.status < 200 || response.status >= 300) throw new Error('call.iceUnavailable');
    const body = responseJson(response) as { ice_servers?: RTCIceServer[] };
    return body.ice_servers ?? [];
  },
});

mobileGroupCallManager.onRoomEvent((event: GroupCallRoomEvent) => {
  void reconcileMobileGroupRoom(event.groupUlid).catch(() => undefined);
});
mobileGroupCallManager.onSnapshot((snapshot) => {
  const actors = snapshot.participants.filter((participant) => !participant.isLocal)
    .map((participant) => participant.actorPtid).filter((ptid) => ptid.startsWith('ptid:')).sort().join('\n');
  if (actors === rosterActors) return;
  rosterActors = actors;
  for (const ptid of actors.split('\n').filter(Boolean)) {
    const store = useSocialStore.getState();
    if (!store.peerProfiles[ptid]) void store.loadPeerProfile(ptid);
  }
});

export function readMobileGroupCallRooms(): ReadonlyMap<string, MobileGroupRoom> { return rooms; }
export function readMobileGroupInvitation(): MobileGroupRoom | null {
  const actor = session?.actorRef.ptid;
  return [...rooms.values()].find((room) => !dismissed.has(room.roomSID)
    && !room.declinedActorPtids.includes(actor ?? '')) ?? null;
}
export function suppressMobileGroupInvitation(room: MobileGroupRoom): void {
  dismissed.add(room.roomSID);
  roomListeners.forEach((listener) => listener());
}
export async function declineMobileGroupInvitation(room: MobileGroupRoom): Promise<void> {
  const current = requireSession();
  const signal = sessionAbort.signal;
  const response = await executeStationOperation(current, {
    operationId: 'group_call_decline', group_ulid: room.groupUlid, room_sid: room.roomSID,
  }, signal);
  if (signal.aborted || session !== current) return;
  if (response.status < 200 || response.status >= 300) {
    throw Object.assign(new Error('call.joinFailed'), { status: response.status });
  }
  suppressMobileGroupInvitation(room);
  await reconcileMobileGroupRoom(room.groupUlid);
}
export function subscribeMobileGroupCallRooms(listener: () => void): () => void {
  roomListeners.add(listener);
  return () => { roomListeners.delete(listener); };
}
export async function activateMobileGroupCalls(next: MobileAuthSession): Promise<void> {
  if (session && (session.sessionId !== next.sessionId
    || session.stationPeerId !== next.stationPeerId || session.actorRef.ptid !== next.actorRef.ptid)) {
    await resetMobileGroupCalls();
  }
  session = next;
  sessionAbort.abort();
  pendingStatus.clear();
  dirtyStatus.clear();
  unsubscribeGroups?.();
  sessionAbort = new AbortController();
  unsubscribeGroups = useSocialStore.subscribe((current, previous) => {
    if (current.messagingConversations !== previous.messagingConversations) reconcileMobileGroupRooms();
  });
  reconcileMobileGroupRooms();
}

export function reconcileMobileGroupRooms(): void {
  if (sessionAbort.signal.aborted) return;
  const groups = useSocialStore.getState().messagingConversations.filter((group) => group.kind === 2);
  const ids = new Set(groups.map((group) => group.conversationId));
  const retained = new Map([...rooms].filter(([id]) => ids.has(id)));
  if (retained.size !== rooms.size) {
    rooms = retained; roomListeners.forEach((listener) => listener());
  }
  for (const group of groups) void reconcileMobileGroupRoom(group.conversationId).catch(() => undefined);
}
export function suspendMobileGroupRoomProjection(): void {
  sessionAbort.abort();
  pendingStatus.clear();
  dirtyStatus.clear();
  unsubscribeGroups?.(); unsubscribeGroups = undefined;
}
export function reconcileMobileGroupRoom(groupUlid: string): Promise<void> {
  const pending = pendingStatus.get(groupUlid);
  if (pending) { dirtyStatus.add(groupUlid); return pending; }
  const current = session;
  if (!current) return Promise.resolve();
  const signal = sessionAbort.signal;
  const task = (async () => {
    const response = await executeStationOperation(current, {
      operationId: 'group_call_status', group_ulid: groupUlid,
    }, signal);
    if (signal.aborted || session !== current) return;
    if (response.status < 200 || response.status >= 300) {
      // A stale invitation is not current authority when its read failed.
      const next = new Map(rooms); next.delete(groupUlid); rooms = next;
      roomListeners.forEach((listener) => listener());
      return;
    }
    const status = responseJson(response) as {
      active?: boolean; room_name?: string; room_sid?: string; declined_actor_ptids?: string[];
    };
    const next = new Map(rooms);
    if (status.active && status.room_name && status.room_sid) {
      next.set(groupUlid, { groupUlid, roomName: status.room_name, roomSID: status.room_sid,
        declinedActorPtids: status.declined_actor_ptids ?? [] });
    } else next.delete(groupUlid);
    rooms = next;
    roomListeners.forEach((listener) => listener());
  })().catch((error) => {
    if (!signal.aborted && session === current) {
      const next = new Map(rooms); next.delete(groupUlid); rooms = next;
      roomListeners.forEach((listener) => listener());
    }
    throw error;
  }).finally(() => {
    if (pendingStatus.get(groupUlid) !== task) return;
    pendingStatus.delete(groupUlid);
    if (dirtyStatus.delete(groupUlid) && !signal.aborted) {
      void reconcileMobileGroupRoom(groupUlid).catch(() => undefined);
    }
  });
  pendingStatus.set(groupUlid, task);
  return task;
}
export function ingestMobileGroupRoomEvent(event: Extract<RealtimeWireEvent, { kind: 'group-call-room' }>): void {
  if (!session) return;
  mobileGroupCallManager.ingestRoomEvent({
    kind: event.roomKind, groupUlid: event.groupUlid, roomName: event.roomName,
  });
}
export async function resetMobileGroupCalls(): Promise<void> {
  session = null;
  sessionAbort.abort();
  unsubscribeGroups?.(); unsubscribeGroups = undefined;
  pendingStatus.clear();
  dirtyStatus.clear();
  rosterActors = '';
  dismissed = new Set();
  rooms = new Map();
  roomListeners.forEach((listener) => listener());
  await mobileGroupCallManager.leaveGroupCall();
}
export { groupCallErrorCode };
