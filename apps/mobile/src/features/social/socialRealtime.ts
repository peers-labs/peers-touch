import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import type { MessageMutationKind } from './socialProjection';
import type { FriendChatMessage } from './socialTypes';
import type { GroupMembershipKind } from './socialWire';
import { decodeRealtimeSseChunk } from './socialWire';

interface RealtimeHandlers {
  onMessage: (sessionUlid: string, message: FriendChatMessage) => void;
  onGroupMessage: (groupUlid: string, message: GroupMessage) => void;
  onReceipt: (sessionUlid: string, messageUlid: string, kind: number) => void;
  onMutation: (
    sessionUlid: string,
    messageUlid: string,
    kind: MessageMutationKind,
    payload: { newContent: string; newCiphertext: Uint8Array<ArrayBufferLike>; mutatedTsUnixMs: number },
  ) => void;
  onTyping: (sessionUlid: string, fromActorPtid: string, typing: boolean) => void;
  onPresence: (ptid: string, online: boolean) => void;
  onGroupMembership: (groupUlid: string, actorPtid: string, kind: GroupMembershipKind) => void;
  onSettingsChanged: (conversationKind: 'friend' | 'group', containerUlid: string) => void;
  onResync: () => void;
}

export async function startRealtimeStream(
  session: MobileAuthSession,
  signal: AbortSignal,
  handlers: RealtimeHandlers,
) {
  const response = await fetch(`${session.stationUrl.replace(/\/+$/, '')}/events/stream`, {
    cache: 'no-store',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${session.accessToken}`,
      'X-Device-ID': `mobile-web-${mobileAuthScopeKey(session)}`,
    },
    signal,
  });
  // #region debug-point K:realtime-stream-response
  void fetch('http://10.4.44.83:7784/event', { method: 'POST', body: JSON.stringify({ sessionId: 'mobile-social-activation', runId: 'typing-pre-fix', hypothesisId: 'K', location: 'apps/mobile/src/features/social/socialRealtime.ts:startRealtimeStream', msg: '[DEBUG] Mobile realtime stream response', data: { ok: response.ok, status: response.status, hasBody: response.body !== null, stationScheme: session.stationUrl.split(':', 1)[0] }, ts: Date.now() }) }).catch(() => {});
  // #endregion
  if (!response.ok || !response.body) throw new Error('mobile.social.realtimeUnavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    chunks.forEach((chunk) => dispatchWireEvents(chunk, handlers));
  }
}

function dispatchWireEvents(chunk: string, handlers: RealtimeHandlers) {
  decodeRealtimeSseChunk(chunk).forEach((event) => {
    if (event.kind === 'typing') {
      // #region debug-point K-L:typing-event-decoded
      void fetch('http://10.4.44.83:7784/event', { method: 'POST', body: JSON.stringify({ sessionId: 'mobile-social-activation', runId: 'typing-pre-fix', hypothesisId: 'K-L', location: 'apps/mobile/src/features/social/socialRealtime.ts:dispatchWireEvents', msg: '[DEBUG] Mobile typing event decoded', data: { conversationId: event.sessionUlid, fromActorPtid: event.fromActorPtid, typing: event.typing }, ts: Date.now() }) }).catch(() => {});
      // #endregion
    }
    if (event.kind === 'message') {
      handlers.onMessage(event.sessionUlid, event.message);
      return;
    }
    if (event.kind === 'group-message') {
      handlers.onGroupMessage(event.groupUlid, event.message);
      return;
    }
    if (event.kind === 'receipt') {
      handlers.onReceipt(event.sessionUlid, event.messageUlid, event.receiptKind);
      return;
    }
    if (event.kind === 'mutation') {
      handlers.onMutation(event.sessionUlid, event.messageUlid, event.mutationKind, {
        newContent: event.newContent,
        newCiphertext: event.newCiphertext,
        mutatedTsUnixMs: event.mutatedTsUnixMs,
      });
      return;
    }
    if (event.kind === 'typing') {
      handlers.onTyping(event.sessionUlid, event.fromActorPtid, event.typing);
      return;
    }
    if (event.kind === 'presence') {
      handlers.onPresence(event.ptid, event.online);
      return;
    }
    if (event.kind === 'group-membership') {
      handlers.onGroupMembership(event.groupUlid, event.actorPtid, event.membershipKind);
      return;
    }
    if (event.kind === 'settings-changed') {
      handlers.onSettingsChanged(event.conversationKind, event.containerUlid);
      return;
    }
    handlers.onResync();
  });
}
