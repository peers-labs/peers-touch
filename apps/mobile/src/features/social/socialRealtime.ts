import type { MobileAuthSession } from '../auth/authSession';
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
  onTyping: (sessionUlid: string, fromActorId: string, typing: boolean) => void;
  onPresence: (actorId: string, online: boolean) => void;
  onGroupMembership: (groupUlid: string, actorDid: string, kind: GroupMembershipKind) => void;
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
      'X-Device-ID': `mobile-web-${session.sessionId}`,
    },
    signal,
  });
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
      handlers.onTyping(event.sessionUlid, event.fromActorId, event.typing);
      return;
    }
    if (event.kind === 'presence') {
      handlers.onPresence(event.actorId, event.online);
      return;
    }
    if (event.kind === 'group-membership') {
      handlers.onGroupMembership(event.groupUlid, event.actorDid, event.membershipKind);
      return;
    }
    if (event.kind === 'settings-changed') {
      handlers.onSettingsChanged(event.conversationKind, event.containerUlid);
      return;
    }
    handlers.onResync();
  });
}
