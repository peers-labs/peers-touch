import { eventBus } from '../kernel/events';
import { EVENT } from '../kernel/events/catalog';
import { retrySkdmDistributionFor, rotateGroupSenderChain } from '../modules/identity/groupSenderKeys';
import { useSocialChatStore } from '../store/socialChat';
import { log } from '../utils/logger';
import { api } from './desktop_api';

let teardowns: Array<() => void> | null = null;
let typingSweepHandle: number | null = null;

async function refreshSessionAfterRealtimeMessage(sessionUlid: string): Promise<void> {
  const state = useSocialChatStore.getState();
  if (state.activeTab === 'friend' && state.activeSessionUlid === sessionUlid) {
    await state.loadMessages(sessionUlid, 'friend');
    return;
  }

  await state.loadSessions();
  await useSocialChatStore.getState().loadConversationPreviews();
}

export function installSocialChatRealtimeBridge(): void {
  if (teardowns) return;

  const offMessage = eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIVED, (payload) => {
    const sid = payload.sessionUlid;
    if (!sid) return;

    api.friendChatSync(sid, 50, 1)
      .then(() => refreshSessionAfterRealtimeMessage(sid))
      .catch((error) => log.warn('socialChat', 'realtime sync failed', error));

    const myDid = useSocialChatStore.getState().currentUserDid;
    if (payload.senderActorId && myDid && payload.senderActorId !== myDid && payload.messageUlid) {
      api.friendChatAckMessages([payload.messageUlid], 3).catch((error) => {
        log.warn('socialChat', 'auto DELIVERED ack failed', error);
      });
    }
  });

  const offReceipt = eventBus.subscribe(EVENT.REALTIME_MESSAGE_RECEIPT, (payload) => {
    useSocialChatStore.getState().applyMessageReceipt(
      payload.sessionUlid,
      payload.messageUlid,
      payload.kind,
    );
  });

  const offTyping = eventBus.subscribe(EVENT.REALTIME_TYPING_STATE, (payload) => {
    const myDid = useSocialChatStore.getState().currentUserDid;
    if (myDid && payload.fromActorId === myDid) return;
    useSocialChatStore.getState().applyTypingState(
      payload.sessionUlid,
      payload.fromActorId,
      payload.typing,
    );
  });

  const offSkdmInstalled = eventBus.subscribe(EVENT.GROUP_SKDM_INSTALLED, (payload) => {
    useSocialChatStore.getState()
      .redecryptGroupMessages(payload.groupUlid, payload.senderDid)
      .catch((error) => log.warn('socialChat', 'redecryptGroupMessages failed', error));
  });

  const offPresenceFlip = eventBus.subscribe(EVENT.REALTIME_PRESENCE_FLIP, (payload) => {
    if (!payload.online) return;
    const did = useSocialChatStore.getState().currentUserDid;
    if (!did || payload.actorId === did) return;
    retrySkdmDistributionFor(did, payload.actorId).catch((error) => {
      log.warn('socialChat', 'retrySkdmDistributionFor failed', error);
    });
  });

  const offMutation = eventBus.subscribe(EVENT.REALTIME_MESSAGE_MUTATION, (payload) => {
    useSocialChatStore.getState().applyMessageMutation(
      payload.sessionUlid,
      payload.messageUlid,
      payload.kind,
      {
        newContent: payload.newContent,
        newCiphertext: payload.newCiphertext,
        mutatedTsUnixMs: payload.mutatedTsUnixMs,
      },
    );
  });

  const offGroupMembership = eventBus.subscribe(EVENT.REALTIME_GROUP_MEMBERSHIP_CHANGE, (payload) => {
    const store = useSocialChatStore.getState();
    const did = store.currentUserDid;
    if (payload.kind === 'ADDED') {
      store.loadGroupMembers(payload.groupUlid).catch((error) => {
        log.warn('socialChat', 'loadGroupMembers after roster add failed', error);
      });
      return;
    }
    if (payload.kind === 'REMOVED' || payload.kind === 'LEFT') {
      if (did && payload.actorDid === did) {
        store.loadGroups().catch((error) => {
          log.warn('socialChat', 'loadGroups after membership end failed', error);
        });
        store.selectGroup('');
        return;
      }
      if (did) {
        rotateGroupSenderChain(did, payload.groupUlid).catch((error) => {
          log.warn('socialChat', 'rotateGroupSenderChain failed', error);
        });
      }
      store.loadGroupMembers(payload.groupUlid).catch((error) => {
        log.warn('socialChat', 'loadGroupMembers after roster shrink failed', error);
      });
    }
  });

  if (typeof window !== 'undefined') {
    const TTL_MS = 6000;
    const SWEEP_INTERVAL_MS = 2000;
    typingSweepHandle = window.setInterval(() => {
      useSocialChatStore.getState().sweepTypingPeers(Date.now() - TTL_MS);
    }, SWEEP_INTERVAL_MS);
  }

  teardowns = [
    offMessage,
    offReceipt,
    offTyping,
    offSkdmInstalled,
    offPresenceFlip,
    offMutation,
    offGroupMembership,
  ];
  log.info('socialChat', 'realtime bridge installed');
}

export function teardownSocialChatRealtimeBridge(): void {
  if (teardowns) {
    for (const teardown of teardowns) {
      try { teardown(); } catch { /* noop */ }
    }
    teardowns = null;
  }
  if (typingSweepHandle != null) {
    window.clearInterval(typingSweepHandle);
    typingSweepHandle = null;
  }
}
