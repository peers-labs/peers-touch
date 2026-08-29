import { invoke } from '@tauri-apps/api/core';
import { getBootTrace } from '../../kernel/boot';
import { EVENT } from '../../kernel/events';
import { eventDebugBuffer } from '../../kernel/events/debug';
import { identityRuntime } from '../../kernel/identityRuntime';
import { refreshSocialProjection } from '../../services/socialRealtime';
import {
  api,
  getAcceptanceAuthCommandDebugEvents,
} from '../../services/desktop_api';
import type { GroupChatFederatedActorInput, RustCommandResult } from '../../services/desktop_api';
import { dispatchRealtimeFrameForAcceptance } from '../../services/eventStream';
import { imServiceV1 } from '../../services/im-service';
import { useSessionStore } from '../../store/session';
import { createEncryptedChatPayloadBytes, decodeGroupMessages, useSocialChatStore } from '../../store/socialChat';
import { messageGroupSeq } from '../../store/socialProjection';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { registerAcceptanceHarness } from '../registry';
import { requireCanonicalAcceptancePtid } from './identity';

interface LoginInput {
  account: string;
  password: string;
}

interface SyncFriendInput {
  sessionUlid: string;
  limit?: number;
  maxPages?: number;
}

interface CreateGroupInput {
  name: string;
  description?: string;
  memberDids?: string[];
  initialFederatedMembers?: GroupChatFederatedActorInput[];
}

interface SyncGroupInput {
  groupUlid: string;
  limit?: number;
  maxPages?: number;
}

interface SendGroupMessageInput {
  groupUlid: string;
  content: string;
  type?: number;
}

interface SendGroupMessagesInput {
  groupUlid: string;
  prefix: string;
  count: number;
  startIndex?: number;
  type?: number;
}

interface SyncGroupPressureInput {
  groupUlid: string;
  expectedCount: number;
  prefix: string;
  limit?: number;
  maxPages?: number;
}

interface SyncGroupPressureProjectionInput {
  groupUlid: string;
  limit?: number;
  maxPages?: number;
}

interface SyncGroupPressurePageInput {
  groupUlid: string;
  prefix: string;
  beforeUlid?: string;
  limit?: number;
}

interface DecodeGroupPressureInput {
  groupUlid: string;
  prefix: string;
  expectedCount: number;
  chunkSize?: number;
}

interface RemoveGroupMemberInput {
  groupUlid: string;
  memberDid: string;
}

interface AddFederatedGroupMemberInput {
  groupUlid: string;
  member: GroupChatFederatedActorInput;
}

type ConversationKind = 'friend' | 'group';

interface SendInteractionMessageInput {
  conversationId: string;
  kind: ConversationKind;
  content: string;
  replyToMessageId?: string;
  threadRootMessageId?: string;
}

interface MessageInteractionInput {
  conversationId: string;
  kind: ConversationKind;
  messageId: string;
}

interface EditMessageInput extends MessageInteractionInput {
  plaintext: string;
}

interface MetadataInteractionInput extends MessageInteractionInput {
  interaction: 'retract' | 'reaction' | 'pin';
  reaction?: string;
  remove?: boolean;
}

interface ReadCursorInput {
  conversationId: string;
  kind: ConversationKind;
  lastReadSequence?: number;
}

interface TypingInput {
  conversationId: string;
  typing: boolean;
}

function selectConversation(kind: ConversationKind, conversationId: string): void {
  const social = useSocialChatStore.getState();
  if (kind === 'friend') {
    social.selectSession(conversationId);
  } else {
    social.selectGroup(conversationId);
  }
  social.setActiveTab(kind);
}

async function refreshConversation(
  kind: ConversationKind,
  conversationId: string,
): Promise<void> {
  const social = useSocialChatStore.getState();
  await social.loadMessages(conversationId, kind);
  selectConversation(kind, conversationId);
}

function interactionProjection(
  kind: ConversationKind,
  conversationId: string,
  messageId: string,
) {
  const state = useSocialChatStore.getState();
  const message = state
    .getIMMessages(kind, conversationId)
    .find((item) => item.id === messageId);
  const raw = (state.messages[conversationId] ?? [])
    .find((item) => item.ulid === messageId);
  if (!message || !raw) return null;
  return {
    conversationId,
    kind,
    messageId,
    content: message.content,
    senderId: message.senderId,
    replyToMessageId: message.replyToUlid ?? '',
    threadRootMessageId: message.threadRootUlid ?? '',
    edited: Boolean(message.editedAtMs),
    retracted: Boolean(raw.recalled),
    sequence: messageGroupSeq(raw),
    reactions: state.reactions[messageId] ?? [],
    pinned: Boolean(state.pinnedMessages[messageId]),
    readByPtids: message.readByPtids,
  };
}

function activeActorId(): string | null {
  return useSessionStore.getState().currentUser?.actorId ?? null;
}

function activeActorPtid(): string {
  return requireCanonicalAcceptancePtid(
    useSocialChatStore.getState().currentUserDid,
  );
}

async function waitForIdentityState(
  predicate: (snapshot: ReturnType<typeof identityRuntime.getSnapshot>) => boolean,
  description: string,
  timeoutMs = 30_000,
): Promise<void> {
  if (predicate(identityRuntime.getSnapshot())) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for ${description}`));
    }, timeoutMs);
    const unsubscribe = identityRuntime.subscribe(() => {
      if (!predicate(identityRuntime.getSnapshot())) return;
      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

interface PressureWindowState {
  rawByUlid: Map<string, GroupMessage>;
  decodedByUlid: Map<string, GroupMessage>;
  nextDecodeIndex: number;
}

const groupPressureWindows = new Map<string, PressureWindowState>();

function groupPressureWindow(groupUlid: string): PressureWindowState {
  let state = groupPressureWindows.get(groupUlid);
  if (!state) {
    state = {
      rawByUlid: new Map<string, GroupMessage>(),
      decodedByUlid: new Map<string, GroupMessage>(),
      nextDecodeIndex: 0,
    };
    groupPressureWindows.set(groupUlid, state);
  }
  return state;
}

function orderedPressureMessages(state: PressureWindowState): GroupMessage[] {
  return Array.from(state.rawByUlid.values()).sort((a, b) => {
    const secondsDelta = Number(a.sentAt?.seconds ?? 0n) - Number(b.sentAt?.seconds ?? 0n);
    if (secondsDelta) return secondsDelta;
    const nanosDelta = Number(a.sentAt?.nanos ?? 0) - Number(b.sentAt?.nanos ?? 0);
    return nanosDelta || (a.ulid || '').localeCompare(b.ulid || '');
  });
}

async function hydrateSocialForActiveActor(): Promise<void> {
  const actorId = activeActorId();
  if (actorId) {
    await refreshSocialProjection('acceptance hydration', true);
  }
}

export function installAcceptanceHarness(): void {
  (window as any).__PT_ACCEPTANCE_STORE__ = useSocialChatStore;
  registerAcceptanceHarness('chat', {
    async loginWithPassword({ account, password }: LoginInput) {
      await waitForIdentityState(
        ({ phase, lifecycle }) => phase.kind === 'accountGate' && lifecycle.dataReady,
        'identity account gate',
      );
      await identityRuntime.loginWithPassword(account, password);
      await identityRuntime.completeCurrentSession();
      await waitForIdentityState(
        ({ lifecycle }) => lifecycle.state === 'ready' && lifecycle.authenticated,
        'authenticated identity lifecycle',
      );
      return {
        authenticated: true,
        actorId: activeActorId(),
      };
    },

    async hydrateActiveActor() {
      await hydrateSocialForActiveActor();
      return {
        actorId: activeActorPtid(),
      };
    },

    async createDirectConversation({ peerPtid }: { peerPtid: string }) {
      const conversation = await imServiceV1.messaging.createDirect(peerPtid);
      await useSocialChatStore.getState().loadSessions();
      return { conversationId: conversation.conversationId };
    },

    async syncFriendSession({ sessionUlid, limit: _limit = 50, maxPages: _maxPages = 1 }: SyncFriendInput) {
      await refreshConversation('friend', sessionUlid);
      const messages = useSocialChatStore.getState().getIMMessages('friend', sessionUlid);
      return {
        sessionUlid,
        messageCount: messages.length,
        syncedCount: messages.length,
        pagesFetched: 1,
      };
    },

    async createGroup({ name, description: _description, memberDids = [], initialFederatedMembers: _initialFederatedMembers = [] }: CreateGroupInput) {
      const conversationId = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
      const result = await imServiceV1.messaging.createGroup(conversationId, name || 'Acceptance Group', memberDids);
      const groupUlid = result.conversationId || conversationId;
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async syncGroup({ groupUlid, limit: _limit = 50, maxPages: _maxPages = 1 }: SyncGroupInput) {
      const social = useSocialChatStore.getState();
      await imServiceV1.conversation.syncFromStation(groupUlid, _limit).catch(() => {});
      await social.loadGroups();
      await social.loadMessages(groupUlid, 'group');
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      const messages = useSocialChatStore.getState().getIMMessages('group', groupUlid);
      return {
        groupUlid,
        messageCount: messages.length,
        syncedCount: messages.length,
        pagesFetched: 1,
      };
    },

    async sendInteractionMessage({
      conversationId,
      kind,
      content,
      replyToMessageId = '',
      threadRootMessageId = '',
    }: SendInteractionMessageInput) {
      const outcome = await imServiceV1.messaging.sendMessage(
        conversationId,
        kind === 'friend' ? 'direct' : 'group',
        content,
        [],
        {
          replyToMessageId: replyToMessageId || undefined,
          threadRootMessageId: threadRootMessageId || undefined,
        },
      );
      await refreshConversation(kind, conversationId);
      return {
        ...outcome,
        projection: interactionProjection(kind, conversationId, outcome.messageId),
      };
    },

    async editInteractionMessage({
      conversationId,
      kind,
      messageId,
      plaintext,
    }: EditMessageInput) {
      const result = await api.messagingEditMessage(
        conversationId,
        messageId,
        plaintext,
      );
      return {
        ...result,
        kind,
        messageId,
      };
    },

    async submitMetadataInteraction({
      conversationId,
      kind,
      messageId,
      interaction,
      reaction = '',
      remove = false,
    }: MetadataInteractionInput) {
      const result = await api.messagingMetadataInteraction(
        conversationId,
        messageId,
        interaction,
        { reaction, remove },
      );
      return {
        ...result,
        kind,
        messageId,
        interaction,
        remove,
      };
    },

    async submitReadCursor({
      conversationId,
      kind,
      lastReadSequence,
    }: ReadCursorInput) {
      await refreshConversation(kind, conversationId);
      const sequence = lastReadSequence
        ?? (useSocialChatStore.getState().messages[conversationId] ?? [])
          .reduce((maximum, message) => Math.max(maximum, messageGroupSeq(message)), 0);
      if (sequence <= 0) {
        throw new Error('No authority-backed message sequence is available for read cursor');
      }
      await api.messagingReadCursor(conversationId, sequence);
      return {
        conversationId,
        readerPtid: activeActorPtid(),
        lastReadSequence: sequence,
      };
    },

    async submitTyping({ conversationId, typing }: TypingInput) {
      const result = await api.messagingTypingSend(conversationId, typing);
      return {
        ...result,
        conversationId,
        senderPtid: activeActorPtid(),
        typing,
      };
    },

    async interactionProjection({
      conversationId,
      kind,
      messageId,
    }: MessageInteractionInput) {
      await refreshConversation(kind, conversationId);
      return interactionProjection(kind, conversationId, messageId);
    },

    // #region debug-point P,Q,R:identity-boot-state
    async debugIdentityLifecycleState() {
      const { phase, lifecycle } = identityRuntime.getSnapshot();
      const session = useSessionStore.getState();
      const relevantEventTypes = new Set<string>([
        EVENT.AUTH_IDENTITY_CHANGED,
        EVENT.AUTH_SESSION_REVOKED,
        EVENT.REALTIME_CONNECTION_STATE,
      ]);
      return {
        phaseKind: phase.kind,
        phaseReason: 'reason' in phase ? phase.reason : null,
        phaseSource: 'source' in phase ? phase.source : null,
        readiness: 'readiness' in phase ? phase.readiness : null,
        lifecycleState: lifecycle.state,
        lifecycleAuthenticated: lifecycle.authenticated,
        dataReady: lifecycle.dataReady,
        sessionAuthenticated: session.authenticated,
        sessionRestoring: session.restoring,
        actorId: session.currentUser?.actorId ?? null,
        bootTrace: getBootTrace().map(entry => ({
          phase: entry.phase,
          finished: entry.finishedAt !== undefined,
        })),
        eventTrace: eventDebugBuffer.list()
          .filter(entry => relevantEventTypes.has(entry.type))
          .slice(-12)
          .map(entry => {
            const payload = (
              entry.payload
              && typeof entry.payload === 'object'
            )
              ? entry.payload as Record<string, unknown>
              : {};
            return {
              type: entry.type,
              timestampMs: entry.timestamp_ms,
              reason: typeof payload.reason === 'string'
                ? payload.reason
                : null,
              connected: typeof payload.connected === 'boolean'
                ? payload.connected
                : null,
              hasRaw: typeof payload.raw === 'string',
            };
          }),
        authCommandTrace: getAcceptanceAuthCommandDebugEvents().slice(-60),
      };
    },
    // #endregion

    // #region debug-point A,B,D:interaction-projection-state
    async debugInteractionProjectionState({
      conversationId,
      kind,
      messageId,
    }: MessageInteractionInput) {
      const actorId = activeActorId();
      const snapshot = () => {
        const social = useSocialChatStore.getState();
        const rawMessages = social.messages[conversationId] ?? [];
        const mappedMessages = social.getIMMessages(kind, conversationId);
        return {
          activeTab: social.activeTab,
          activeSessionUlid: social.activeSessionUlid,
          activeGroupUlid: social.activeGroupUlid,
          rawMessageIds: rawMessages.map(message => message.ulid),
          mappedMessageIds: mappedMessages.map(message => message.id),
          target: interactionProjection(kind, conversationId, messageId),
        };
      };
      const before = snapshot();
      await refreshConversation(kind, conversationId);
      const apiMessages = actorId
        ? await imServiceV1.messaging.listMessages(conversationId)
        : [];
      const nativeResponse = actorId
        ? await invoke<RustCommandResult<{
            messages: Array<{ message_id: string }>;
            debug_context?: Record<string, string>;
          }>>('messaging_list_messages', {
            input: { conversation_id: conversationId },
          })
        : null;
      return {
        actorId,
        authenticated: useSessionStore.getState().authenticated,
        apiMessageIds: apiMessages.map(message => message.messageId),
        nativeMessageIds: nativeResponse?.data?.messages.map(message => message.message_id) ?? [],
        nativeRuntimeContext: nativeResponse?.data?.debug_context ?? null,
        before,
        after: snapshot(),
      };
    },
    // #endregion

    async openInteractionThread({
      conversationId,
      kind,
      messageId,
    }: MessageInteractionInput) {
      await refreshConversation(kind, conversationId);
      const social = useSocialChatStore.getState();
      await social.loadThreadMessages(conversationId, messageId, kind);
      useSocialChatStore.getState().openThread(messageId);
      const thread = useSocialChatStore.getState()
        .getIMThreadMessages(kind, conversationId, messageId);
      return {
        conversationId,
        kind,
        rootMessageId: messageId,
        replyMessageIds: thread
          .filter((message) => message.ulid !== messageId)
          .map((message) => message.ulid),
      };
    },

    async deleteLocalInteractionMessage({
      conversationId,
      kind,
      messageId,
    }: MessageInteractionInput) {
      await useSocialChatStore.getState().deleteMessage(
        conversationId,
        messageId,
        kind,
      );
      return {
        conversationId,
        kind,
        messageId,
        present: Boolean(interactionProjection(kind, conversationId, messageId)),
      };
    },

    async typingProjection({ conversationId }: { conversationId: string }) {
      const peers = useSocialChatStore.getState().typingPeers[conversationId] ?? {};
      return {
        conversationId,
        peers,
        active: Object.values(peers).some((entry) => entry.typing),
      };
    },

    async sendGroupMessage({ groupUlid, content, type = 1 }: SendGroupMessageInput) {
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.sendGroupMessage(groupUlid, content, type);
      await social.loadMessages(groupUlid, 'group');
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      const messages = useSocialChatStore.getState().getIMMessages('group', groupUlid);
      return {
        groupUlid,
        messageUlid: messages[messages.length - 1]?.id ?? '',
        messageCount: messages.length,
      };
    },

    async sendGroupMessages({ groupUlid, prefix, count, startIndex = 1, type = 1 }: SendGroupMessagesInput) {
      if (count < 1) {
        throw new Error('count must be >= 1');
      }
      if (startIndex < 1) {
        throw new Error('startIndex must be >= 1');
      }
      const did = useSocialChatStore.getState().currentUserDid ?? '';
      if (!did) {
        throw new Error('No active actor; cannot send group messages');
      }
      const social = useSocialChatStore.getState();
      await social.loadGroups();

      const startedAt = Date.now();
      const lastIndex = startIndex + count - 1;
      for (let index = startIndex; index <= lastIndex; index += 1) {
        const content = `${prefix}-${String(index).padStart(4, '0')}`;
        const plaintextBytes = createEncryptedChatPayloadBytes(content, [], type);
        const ciphertext = await imServiceV1.mlsGroup.encrypt(groupUlid, plaintextBytes);
        const { create: createProto } = await import('@bufbuild/protobuf');
        const { StationEnvelopeSchema, EnvelopePayloadType } = await import('../../gen/proto/domain/chat/envelope_pb');
        const envelope = createProto(StationEnvelopeSchema, {
          conversationId: groupUlid,
          senderPtid: did,
          payloadType: EnvelopePayloadType.COMMITTED_EVENT,
          payloadBytes: ciphertext,
          idempotencyKey: crypto.randomUUID(),
        });
        await imServiceV1.envelope.submit(envelope);
      }
      await social.loadMessages(groupUlid, 'group').catch(() => {});
      return {
        groupUlid,
        sentCount: count,
        firstContent: `${prefix}-${String(startIndex).padStart(4, '0')}`,
        lastContent: `${prefix}-${String(lastIndex).padStart(4, '0')}`,
        durationMs: Date.now() - startedAt,
      };
    },

    async syncGroupPressure({ groupUlid, expectedCount, prefix, limit: _limit = 100, maxPages: _maxPages = 20 }: SyncGroupPressureInput) {
      let stage = 'start';
      try {
        const social = useSocialChatStore.getState();
        stage = 'loadGroups';
        await social.loadGroups();
        stage = 'loadMessages';
        await social.loadMessages(groupUlid, 'group');
        const messages = useSocialChatStore.getState().getIMMessages('group', groupUlid);
        const firstContent = `${prefix}-${String(1).padStart(4, '0')}`;
        const lastContent = `${prefix}-${String(expectedCount).padStart(4, '0')}`;
        const decodedContents = messages.map((message: any) => message.content || '');
        return {
          ok: true,
          stage: 'complete',
          groupUlid,
          messageCount: messages.length,
          decodedCount: decodedContents.filter((content: string) => content.startsWith(prefix)).length,
          waitingCount: decodedContents.filter((content: string) => content.includes('[Waiting for sender key')).length,
          failedCount: decodedContents.filter((content: string) => content.includes('[Decrypt failed]')).length,
          pagesFetched: 1,
          syncedCount: messages.length,
          firstFound: decodedContents.includes(firstContent),
          lastFound: decodedContents.includes(lastContent),
        };
      } catch (error) {
        return {
          ok: false,
          stage,
          error: String(error instanceof Error ? error.message : error),
          groupUlid,
          messageCount: 0,
          decodedCount: 0,
          waitingCount: 0,
          failedCount: 0,
          pagesFetched: 0,
          syncedCount: 0,
          firstFound: false,
          lastFound: false,
        };
      }
    },

    async syncGroupPressureProjection({ groupUlid }: SyncGroupPressureProjectionInput) {
      groupPressureWindows.set(groupUlid, {
        rawByUlid: new Map<string, GroupMessage>(),
        decodedByUlid: new Map<string, GroupMessage>(),
        nextDecodeIndex: 0,
      });
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadMessages(groupUlid, 'group');
      const messages = useSocialChatStore.getState().getIMMessages('group', groupUlid);
      return {
        groupUlid,
        syncedCount: messages.length,
        pagesFetched: 1,
      };
    },

    async syncGroupPressurePage({ groupUlid, prefix, beforeUlid = '', limit: _limit = 100 }: SyncGroupPressurePageInput) {
      const social = useSocialChatStore.getState();
      await social.loadMessages(groupUlid, 'group');
      const messages = useSocialChatStore.getState().getIMMessages('group', groupUlid);
      const state = groupPressureWindow(groupUlid);
      for (const message of messages as unknown as GroupMessage[]) {
        if (message.ulid) state.rawByUlid.set(message.ulid, message);
      }
      void prefix;
      void beforeUlid;
      return {
        groupUlid,
        messageCount: messages.length,
        bufferedCount: state.rawByUlid.size,
        nextBeforeUlid: '',
        hasMore: false,
      };
    },

    async decodeGroupPressure({ groupUlid, prefix, expectedCount, chunkSize = 100 }: DecodeGroupPressureInput) {
      const state = groupPressureWindow(groupUlid);
      const ordered = orderedPressureMessages(state);
      const decodeSize = Math.max(1, Math.min(200, chunkSize));
      const chunk = ordered.slice(state.nextDecodeIndex, state.nextDecodeIndex + decodeSize);
      if (chunk.length > 0) {
        const decodedChunk = await decodeGroupMessages(groupUlid, chunk, 'acceptance pressure group ordered decrypt failed');
        for (const message of decodedChunk) {
          if (message.ulid) state.decodedByUlid.set(message.ulid, message);
        }
        state.nextDecodeIndex += chunk.length;
      }
      const decoded = ordered.map((message) => state.decodedByUlid.get(message.ulid) ?? message);
      const decodedContents = decoded.map((message) => message.content || '');
      useSocialChatStore.setState((state) => {
        const existing = (state.messages[groupUlid] || []) as GroupMessage[];
        const byUlid = new Map<string, GroupMessage>();
        for (const message of existing) {
          if (message.ulid) byUlid.set(message.ulid, message);
        }
        for (const message of decoded) {
          if (message.ulid) byUlid.set(message.ulid, message);
        }
        const merged = Array.from(byUlid.values()).sort((a, b) => {
          const delta = Number(a.sentAt?.seconds ?? 0n) - Number(b.sentAt?.seconds ?? 0n);
          return delta || (a.ulid || '').localeCompare(b.ulid || '');
        });
        return {
          messages: { ...state.messages, [groupUlid]: merged as any },
        };
      });
      const refreshedSocial = useSocialChatStore.getState();
      refreshedSocial.selectGroup(groupUlid);
      refreshedSocial.setActiveTab('group');
      const firstContent = `${prefix}-${String(1).padStart(4, '0')}`;
      const lastContent = `${prefix}-${String(expectedCount).padStart(4, '0')}`;
      return {
        groupUlid,
        messageCount: decoded.length,
        decodedCount: decodedContents.filter((content) => content.startsWith(prefix)).length,
        waitingCount: decodedContents.filter((content) => content.includes('[Waiting for sender key')).length,
        failedCount: decodedContents.filter((content) => content.includes('[Decrypt failed]')).length,
        firstFound: decodedContents.includes(firstContent),
        lastFound: decodedContents.includes(lastContent),
        completed: state.nextDecodeIndex >= ordered.length,
        decodedWindowCount: state.nextDecodeIndex,
      };
    },

    async addFederatedGroupMember({ groupUlid, member }: AddFederatedGroupMemberInput) {
      const response = await api.groupChatAddFederatedMember(groupUlid, member);
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        success: Boolean(response.success),
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async inviteToGroup({ groupUlid, memberDids }: { groupUlid: string; memberDids: string[] }) {
      const social = useSocialChatStore.getState();
      for (const did of memberDids) {
        await imServiceV1.messaging.submitMembershipIntent({
          conversationId: groupUlid,
          action: 'add_actor',
          targetPtid: did,
        });
      }
      await social.loadGroups();
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async removeGroupMember({ groupUlid, memberDid }: RemoveGroupMemberInput) {
      await imServiceV1.messaging.submitMembershipIntent({
        conversationId: groupUlid,
        action: 'remove_actor',
        targetPtid: memberDid,
      });
      return {
        groupUlid,
        success: true,
        memberDid,
      };
    },

    async getRealtimeDevice() {
      const device = await api.accountGetDeviceId();
      return {
        actorId: activeActorPtid(),
        deviceId: String(device?.device_id ?? ''),
      };
    },

    async revokeCurrentDevice() {
      const device = await api.accountGetDeviceId();
      const deviceId = String(device?.device_id ?? '');
      if (!deviceId) {
        throw new Error('No active device is available for revocation');
      }
      await imServiceV1.device.revoke(deviceId);
      return {
        actorId: activeActorPtid(),
        deviceId,
        revoked: true,
      };
    },

    async dispatchRealtimeFrame({ eventId = '', dataB64 }: { eventId?: string; dataB64: string }) {
      dispatchRealtimeFrameForAcceptance({ event_id: eventId, data_b64: dataB64 });
      return { accepted: Boolean(dataB64) };
    },
  });
}
