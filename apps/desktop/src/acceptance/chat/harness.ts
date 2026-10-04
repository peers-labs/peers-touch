import { identityRuntime } from '../../kernel/identityRuntime';
import { installAuthenticatedCriticalRuntimes } from '../../services/appRuntime';
import { groupCallManager } from '../../modules/groupCall';
import { api } from '../../services/desktop_api';
import { dispatchRealtimeFrameForAcceptance } from '../../services/eventStream';
import { imServiceV1 } from '../../services/im-service';
import {
  refreshPeerPresence,
  refreshSocialProjection,
} from '../../services/socialRealtime';
import { useRelationshipsStore } from '../../store/relationships';
import { useSessionStore } from '../../store/session';
import { socialThreadKey, useSocialChatStore } from '../../store/socialChat';
import { messageGroupSeq, type SocialMessage } from '../../store/socialProjection';
import { ActorDeviceStatus } from '../../gen/proto/domain/actor/actor_pb';
import { callP2p } from '../../modules/p2p/callP2p';
import { registerAcceptanceHarness } from '../registry';
import { requireCanonicalAcceptancePtid } from './identity';
import { nativeAcceptanceBridge } from './nativeBridge';
import { runChatPasswordLogin } from './passwordLogin';

interface LoginInput {
  account: string;
  password: string;
}

interface SyncFriendInput {
  sessionUlid: string;
  limit?: number;
  maxPages?: number;
}

interface OnboardingPeerInput {
  peerPtid: string;
}

interface PresenceSnapshotInput {
  actorPtids: string[];
}

interface SearchMessagesInput {
  conversationId: string;
  query: string;
}

interface CreateGroupInput {
  name: string;
  federationId: string;
  description?: string;
  memberPtids?: string[];
  initialFederatedMembers?: GroupChatFederatedActorInput[];
}

interface GroupChatFederatedActorInput {
  ptid: string;
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
  memberPtid: string;
}

interface AddFederatedGroupMemberInput {
  groupUlid: string;
  member: GroupChatFederatedActorInput;
}

interface UpdateGroupInput {
  groupUlid: string;
  name?: string;
  description?: string;
}

interface UpdateGroupMemberInput {
  groupUlid: string;
  memberPtid: string;
  role?: number;
  muted?: boolean;
  mutedUntilUnixMs?: number;
}

type ConversationKind = 'friend' | 'group';

interface SendInteractionMessageInput {
  conversationId: string;
  kind: ConversationKind;
  content: string;
  replyToMessageId?: string;
  threadRootMessageId?: string;
}

interface SendInteractionMessageBatchInput {
  conversationId: string;
  kind: ConversationKind;
  prefix: string;
  count: number;
  startIndex?: number;
}

interface MessageInteractionInput {
  conversationId: string;
  kind: ConversationKind;
  messageId: string;
  threadRootMessageId?: string;
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
  threadRootMessageId = '',
) {
  const state = useSocialChatStore.getState();
  const messages = threadRootMessageId
    ? state.getIMThreadMessages(kind, conversationId, threadRootMessageId)
    : state.getIMMessages(kind, conversationId);
  const rawMessages = threadRootMessageId
    ? state.threadMessages[
      socialThreadKey(kind, conversationId, threadRootMessageId)
    ] ?? []
    : state.messages[conversationId] ?? [];
  const message = messages
    .find((item) => item.id === messageId);
  const raw = rawMessages
    .find((item) => item.ulid === messageId);
  if (!message || !raw) return null;
  return {
    conversationId,
    kind,
    messageId,
    content: message.content,
    senderPtid: message.senderPtid,
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

function activeSessionActorPtid(): string | null {
  return useSessionStore.getState().currentUser?.actorPtid ?? null;
}

function activeActorPtid(): string {
  return requireCanonicalAcceptancePtid(
    useSocialChatStore.getState().currentUserPtid,
  );
}

function acceptanceCallSnapshot(snapshot: ReturnType<typeof callP2p.getCall>) {
  const tracks = (stream?: MediaStream) => (
    stream?.getTracks().map((track) => ({
      kind: track.kind,
      enabled: track.enabled,
      muted: track.muted,
      readyState: track.readyState,
    })) ?? []
  );
  if (!snapshot) return null;
  return {
    callId: snapshot.callId,
    mediaKind: snapshot.mediaKind,
    state: snapshot.state,
    startedAt: snapshot.startedAt ?? null,
    micMuted: snapshot.micMuted ?? false,
    cameraOff: snapshot.cameraOff ?? false,
    endReason: snapshot.endReason ?? null,
    localTracks: tracks(snapshot.localStream),
    remoteTracks: tracks(snapshot.remoteStream),
  };
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
  rawByUlid: Map<string, SocialMessage>;
  decodedByUlid: Map<string, SocialMessage>;
  nextDecodeIndex: number;
}

const groupPressureWindows = new Map<string, PressureWindowState>();

function groupPressureWindow(groupUlid: string): PressureWindowState {
  let state = groupPressureWindows.get(groupUlid);
  if (!state) {
    state = {
      rawByUlid: new Map<string, SocialMessage>(),
      decodedByUlid: new Map<string, SocialMessage>(),
      nextDecodeIndex: 0,
    };
    groupPressureWindows.set(groupUlid, state);
  }
  return state;
}

function orderedPressureMessages(state: PressureWindowState): SocialMessage[] {
  return Array.from(state.rawByUlid.values()).sort((a, b) => {
    const aTs = a.sentAt as { seconds?: bigint; nanos?: number } | undefined;
    const bTs = b.sentAt as { seconds?: bigint; nanos?: number } | undefined;
    const secondsDelta = Number(aTs?.seconds ?? 0n) - Number(bTs?.seconds ?? 0n);
    if (secondsDelta) return secondsDelta;
    const nanosDelta = Number(aTs?.nanos ?? 0) - Number(bTs?.nanos ?? 0);
    return nanosDelta || (a.ulid || '').localeCompare(b.ulid || '');
  });
}

async function hydrateSocialForActiveActor(): Promise<void> {
  const actorPtid = activeSessionActorPtid();
  if (actorPtid) {
    const social = useSocialChatStore.getState();
    await social.hydrate(actorPtid);
    await useSocialChatStore.getState().initEncryption();
  }
}

async function onboardingSnapshot(peerPtid: string) {
  const actorPtid = activeActorPtid();
  const social = useSocialChatStore.getState();
  const requests = social.friendRequests
    .filter((request) => (
      (request.senderPtid === actorPtid && request.receiverPtid === peerPtid)
      || (request.senderPtid === peerPtid && request.receiverPtid === actorPtid)
    ))
    .map((request) => ({
      id: request.id,
      senderPtid: request.senderPtid,
      receiverPtid: request.receiverPtid,
      status: request.status,
      federationId: request.federationId,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const conversationIds = social.getIMConversations()
    .filter((conversation) => (
      conversation.kind === 'friend'
      && conversation.peerPtid === peerPtid
    ))
    .map((conversation) => conversation.id)
    .sort();

  return {
    actorPtid,
    peerPtid,
    acceptedFriendship: requests.some((request) => request.status === 2),
    requests,
    conversationIds,
  };
}

export function installAcceptanceHarness(): void {
  (window as any).__PT_ACCEPTANCE_STORE__ = useSocialChatStore;
  registerAcceptanceHarness('chat', {
    logout: (input: { actorPtid: string }) =>
      nativeAcceptanceBridge.logout(input),

    engineInteractionSnapshot: (input: {
      actorPtid: string;
      conversationId: string;
      messageId: string;
      commandId?: string;
    }) => nativeAcceptanceBridge.engineInteractionSnapshot(input),

    prepareSubmittedCommand: (input: {
      actorPtid: string;
      conversationId: string;
      messageId: string;
      commandId: string;
    }) => nativeAcceptanceBridge.prepareSubmittedCommand(input),

    createRestorableCommand: (input: {
      actorPtid: string;
      conversationId: string;
      plaintext: string;
    }) => nativeAcceptanceBridge.createRestorableCommand(input),

    resumeMessagingLifecycle: (input: { actorPtid: string }) =>
      nativeAcceptanceBridge.resumeMessagingLifecycle(input),

    engineMessages: (input: {
      actorPtid: string;
      conversationId: string;
    }) => nativeAcceptanceBridge.engineMessages(input),

    engineConversations: (input: { actorPtid: string }) =>
      nativeAcceptanceBridge.engineConversations(input),

    conversationMemberSettings: (input: {
      actorPtid: string;
      conversationId: string;
    }) => nativeAcceptanceBridge.conversationMemberSettings(input),

    openAttachment: (input: {
      actorPtid: string;
      attachmentId: string;
    }) => nativeAcceptanceBridge.openAttachment(input),

    identityState: () => nativeAcceptanceBridge.identityState(),

    async loginWithPassword({ account, password }: LoginInput) {
      const readIdentityLoginState = () => {
        const snapshot = identityRuntime.getSnapshot();
        return {
          phaseKind: snapshot.phase.kind,
          lifecycleState: snapshot.lifecycle.state,
          dataReady: snapshot.lifecycle.dataReady,
          authenticated: useSessionStore.getState().authenticated,
        };
      };
      await runChatPasswordLogin({
        boot: () => identityRuntime.boot(),
        readState: readIdentityLoginState,
        waitFor: (predicate, description) => waitForIdentityState(
          () => predicate(readIdentityLoginState()),
          description,
        ),
        logout: () => identityRuntime.logout(),
        loginWithPassword: (loginAccount, loginPassword) =>
          identityRuntime.loginWithPassword(loginAccount, loginPassword),
        completeCurrentSession: () =>
          identityRuntime.completeCurrentSession(),
      }, account, password);
      const actorPtid = activeActorPtid();
      await installAuthenticatedCriticalRuntimes(actorPtid);
      await hydrateSocialForActiveActor();
      return {
        authenticated: true,
        actorPtid: actorPtid,
      };
    },

    async hydrateActiveActor() {
      await hydrateSocialForActiveActor();
      return {
        actorPtid: activeActorPtid(),
      };
    },

    async federationContext() {
      const response = await api.federationListFederations();
      return {
        federations: response.federations.map((federation) => ({
          federationId: federation.federationId,
          name: federation.name,
          status: federation.status,
        })),
      };
    },

    async onboardingIdentity() {
      const identity = await api.federationGetSelf();
      return {
        actorPtid: activeActorPtid(),
        preferredUsername: identity.preferredUsername,
        federatedHandle: identity.federatedHandle,
        homeStationPeerId: identity.homeStationPeerId,
        homeStationDomain: identity.homeStationDomain,
        locatorSeq: Number(identity.locatorSeq),
      };
    },

    async presenceSnapshot({ actorPtids }: PresenceSnapshotInput) {
      await refreshPeerPresence(actorPtids);
      const peerOnline = useSocialChatStore.getState().peerOnline;
      return {
        statuses: actorPtids.map((actorPtid) => ({
          actorPtid,
          online: actorPtid in peerOnline ? peerOnline[actorPtid] : null,
        })),
      };
    },

    async searchMessages({ conversationId, query }: SearchMessagesInput) {
      const social = useSocialChatStore.getState();
      await social.searchMessages(query, 'friend', conversationId);
      return {
        messageIds: useSocialChatStore.getState().searchResults
          .map((result) => result.messageId),
      };
    },

    async prepareOnboardingPeer({ peerPtid }: OnboardingPeerInput) {
      const actorPtid = activeActorPtid();
      const relationships = useRelationshipsStore.getState();
      await relationships.unfollow(peerPtid);

      const social = useSocialChatStore.getState();
      await social.loadFriendRequests();
      const pendingIncoming = useSocialChatStore.getState().friendRequests
        .filter((request) => (
          request.status === 1
          && request.senderPtid === peerPtid
          && request.receiverPtid === actorPtid
        ));
      for (const request of pendingIncoming) {
        await useSocialChatStore.getState().rejectFriendRequest(request);
      }
      await refreshSocialProjection('acceptance:onboarding-prepare', true);
      return onboardingSnapshot(peerPtid);
    },

    async refreshOnboardingProjection({ peerPtid }: OnboardingPeerInput) {
      await refreshSocialProjection('acceptance:onboarding-readback', true);
      return onboardingSnapshot(peerPtid);
    },

    async createDirectConversation({
      peerPtid,
      federationId,
    }: {
      peerPtid: string;
      federationId: string;
    }) {
      const conversation = await imServiceV1.messaging.createDirect({
        peerPtid,
        federationId,
      });
      await useSocialChatStore.getState().loadSessions();
      return { conversationId: conversation.conversationId };
    },

    async syncFriendSession({ sessionUlid, limit: _limit = 50, maxPages = 1 }: SyncFriendInput) {
      const social = useSocialChatStore.getState();
      await social.loadMessages(sessionUlid, 'friend');
      let pagesFetched = 1;
      while (
        pagesFetched < maxPages
        && useSocialChatStore.getState().messageHasMore[sessionUlid]
      ) {
        await useSocialChatStore.getState().loadOlderMessages(
          sessionUlid,
          'friend',
        );
        pagesFetched += 1;
      }
      selectConversation('friend', sessionUlid);
      const messages = useSocialChatStore.getState()
        .getIMMessages('friend', sessionUlid);
      return {
        sessionUlid,
        messageCount: messages.length,
        syncedCount: messages.length,
        pagesFetched,
      };
    },

    async parkConversation() {
      useSocialChatStore.setState({
        activeSessionUlid: null,
        activeGroupUlid: null,
        openThreadRootUlid: null,
      });
      return { parked: true };
    },

    async messagePage({
      conversationId,
      beforeSequence,
      limit = 50,
    }: {
      conversationId: string;
      beforeSequence?: number;
      limit?: number;
    }) {
      const page = await imServiceV1.messaging.listMessages(
        conversationId,
        { beforeSequence, limit },
      );
      return {
        messageIds: page.messages.map(message => message.messageId),
        sequences: page.messages.map(message => message.eventSequence ?? 0),
        hasMore: page.hasMore,
        nextBeforeSequence: page.nextBeforeSequence ?? null,
      };
    },

    async createGroup({
      name,
      federationId,
      description: _description,
      memberPtids = [],
      initialFederatedMembers: _initialFederatedMembers = [],
    }: CreateGroupInput) {
      const conversationId = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
      const result = await imServiceV1.messaging.createGroup(
        conversationId,
        name || 'Acceptance Group',
        memberPtids,
        federationId,
      );
      const groupUlid = result.conversationId || conversationId;
      const social = useSocialChatStore.getState();
      social.setGroupSecurityState(groupUlid, 'establishing');
      social.trackPendingGroupCreation(groupUlid, result.commandId);
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        commandId: result.commandId,
        state: result.state,
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async updateGroup({ groupUlid, name, description }: UpdateGroupInput) {
      return imServiceV1.messaging.updateConversation(groupUlid, { name, description });
    },

    async updateGroupMember({
      groupUlid,
      memberPtid,
      role,
      muted,
      mutedUntilUnixMs,
    }: UpdateGroupMemberInput) {
      return imServiceV1.messaging.updateMemberAuthority(groupUlid, memberPtid, {
        role,
        muted,
        mutedUntilUnixMs,
      });
    },

    async transferGroupOwnership({
      groupUlid,
      memberPtid,
    }: RemoveGroupMemberInput) {
      return imServiceV1.messaging.transferOwnership(groupUlid, memberPtid);
    },

    async leaveGroup({ groupUlid }: { groupUlid: string }) {
      return imServiceV1.messaging.leaveConversation(groupUlid);
    },

    async dissolveGroup({ groupUlid }: { groupUlid: string }) {
      return imServiceV1.messaging.dissolveConversation(groupUlid);
    },

    async groupLifecycleSnapshot({ groupUlid }: { groupUlid: string }) {
      const conversation = (await imServiceV1.messaging.listConversations())
        .find(candidate => candidate.conversationId === groupUlid);
      return conversation
        ? {
            conversationId: conversation.conversationId,
            name: conversation.name,
            ownerPtid: conversation.ownerPtid,
            membershipEpoch: conversation.membershipEpoch,
            mlsEpoch: conversation.mlsEpoch,
            mlsStatus: conversation.mlsStatus,
            active: conversation.active,
            members: conversation.members.map(member => ({
              ptid: member.ptid,
              role: member.role,
              muted: member.muted,
            })),
          }
        : null;
    },

    async syncGroup({ groupUlid, limit: _limit = 50, maxPages: _maxPages = 1 }: SyncGroupInput) {
      const social = useSocialChatStore.getState();
      await imServiceV1.conversation.syncFromStation(groupUlid, _limit).catch(() => {});
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      await social.loadMessages(groupUlid, 'group');
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      const state = useSocialChatStore.getState();
      const messages = state.getIMMessages('group', groupUlid);
      const conversation = state.getIMConversations().find(
        (item) => item.kind === 'group' && item.id === groupUlid,
      );
      return {
        groupUlid,
        groupName: conversation?.title ?? '',
        memberPtids: (state.groupMembers[groupUlid] ?? [])
          .map((member) => member.ptid)
          .filter(Boolean)
          .sort(),
        securityState: state.groupSecurityState[groupUlid] ?? 'unknown',
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

    async sendInteractionMessageBatch({
      conversationId,
      kind,
      prefix,
      count,
      startIndex = 1,
    }: SendInteractionMessageBatchInput) {
      if (count < 1 || count > 100) {
        throw new Error('interaction message batch count must be between 1 and 100');
      }
      if (startIndex < 1) {
        throw new Error('interaction message batch startIndex must be positive');
      }
      const messageIds: string[] = [];
      for (let offset = 0; offset < count; offset += 1) {
        const index = startIndex + offset;
        const outcome = await imServiceV1.messaging.sendMessage(
          conversationId,
          kind === 'friend' ? 'direct' : 'group',
          `${prefix}-${String(index).padStart(3, '0')}`,
        );
        messageIds.push(outcome.messageId);
      }
      return {
        conversationId,
        count: messageIds.length,
        firstMessageId: messageIds[0] ?? '',
        lastMessageId: messageIds[messageIds.length - 1] ?? '',
        messageIds,
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
      threadRootMessageId = '',
    }: MessageInteractionInput) {
      await refreshConversation(kind, conversationId);
      if (threadRootMessageId) {
        await useSocialChatStore.getState().loadThreadMessages(
          conversationId,
          threadRootMessageId,
          kind,
        );
      }
      return interactionProjection(
        kind,
        conversationId,
        messageId,
        threadRootMessageId,
      );
    },

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
      await social.loadGroupMembers(groupUlid);
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
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      if (type !== 1) {
        throw new Error('group pressure send supports text messages only');
      }

      const startedAt = Date.now();
      const lastIndex = startIndex + count - 1;
      for (let index = startIndex; index <= lastIndex; index += 1) {
        const content = `${prefix}-${String(index).padStart(4, '0')}`;
        await imServiceV1.messaging.sendMessage(groupUlid, 'group', content);
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
        stage = 'loadGroupMembers';
        await social.loadGroupMembers(groupUlid);
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
        rawByUlid: new Map<string, SocialMessage>(),
        decodedByUlid: new Map<string, SocialMessage>(),
        nextDecodeIndex: 0,
      });
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
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
      for (const message of messages as unknown as SocialMessage[]) {
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
      for (const message of chunk) {
        if (message.ulid) state.decodedByUlid.set(message.ulid, message);
      }
      state.nextDecodeIndex += chunk.length;
      const decoded = ordered.map((message) => state.decodedByUlid.get(message.ulid) ?? message);
      const decodedContents = decoded.map((message) => message.content || '');
      useSocialChatStore.setState((state) => {
        const existing = (state.messages[groupUlid] || []) as SocialMessage[];
        const byUlid = new Map<string, SocialMessage>();
        for (const message of existing) {
          if (message.ulid) byUlid.set(message.ulid, message);
        }
        for (const message of decoded) {
          if (message.ulid) byUlid.set(message.ulid, message);
        }
        const merged = Array.from(byUlid.values()).sort((a, b) => {
          const aTs = a.sentAt as { seconds?: bigint } | undefined;
          const bTs = b.sentAt as { seconds?: bigint } | undefined;
          const delta = Number(aTs?.seconds ?? 0n) - Number(bTs?.seconds ?? 0n);
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
      await imServiceV1.messaging.submitMembershipIntent({
        conversationId: groupUlid,
        action: 'add_actor',
        targetPtid: member.ptid,
      });
      const social = useSocialChatStore.getState();
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        success: true,
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async inviteToGroup({ groupUlid, memberPtids }: { groupUlid: string; memberPtids: string[] }) {
      const social = useSocialChatStore.getState();
      for (const did of memberPtids) {
        await imServiceV1.messaging.submitMembershipIntent({
          conversationId: groupUlid,
          action: 'add_actor',
          targetPtid: did,
        });
      }
      await social.loadGroups();
      await social.loadGroupMembers(groupUlid);
      social.selectGroup(groupUlid);
      social.setActiveTab('group');
      return {
        groupUlid,
        memberCount: useSocialChatStore.getState().groupMembers[groupUlid]?.length ?? 0,
      };
    },

    async removeGroupMember({ groupUlid, memberPtid }: RemoveGroupMemberInput) {
      await imServiceV1.messaging.submitMembershipIntent({
        conversationId: groupUlid,
        action: 'remove_actor',
        targetPtid: memberPtid,
      });
      return {
        groupUlid,
        success: true,
        memberPtid,
      };
    },

    async getRealtimeDevice() {
      const actorPtid = activeActorPtid();
      const device = await api.messagingAcceptanceCurrentEndpoint(actorPtid);
      const deviceId = String(device?.device_id ?? '');
      const devices = await imServiceV1.device.list();
      const active = devices.some(candidate => (
        candidate.ref?.actor?.ptid === actorPtid
        && candidate.ref?.deviceId === deviceId
        && candidate.status === ActorDeviceStatus.ACTIVE
      ));
      return {
        actorPtid: String(device?.actor_ptid ?? ''),
        deviceId,
        active,
      };
    },

    async initiateCall({ calleePtid }: { calleePtid: string }) {
      return callP2p.initiateCallForAcceptance(
        activeActorPtid(),
        requireCanonicalAcceptancePtid(calleePtid),
      );
    },

    async callResolutionState({ callId }: { callId: string }) {
      return callP2p.callResolutionStateForAcceptance(callId);
    },

    async acceptCall({ callId }: { callId: string }) {
      return callP2p.resolveCallForAcceptance(callId, 'accept');
    },

    async rejectCall({ callId }: { callId: string }) {
      return callP2p.resolveCallForAcceptance(callId, 'reject');
    },

    async disconnectRealtime() {
      await api.realtimeStreamStop();
      return { disconnected: true };
    },

    async reconnectRealtime() {
      await api.realtimeStreamStart(
        useSessionStore.getState().sessionEpoch,
      );
      return { connected: true };
    },

    async mlsReadiness() {
      const actorPtid = activeActorPtid();
      const device = await api.messagingAcceptanceCurrentEndpoint(actorPtid);
      const deviceId = String(device?.device_id ?? '');
      const devices = await imServiceV1.device.list();
      const active = devices.some(candidate => (
        candidate.ref?.actor?.ptid === actorPtid
        && candidate.ref?.deviceId === deviceId
        && candidate.status === ActorDeviceStatus.ACTIVE
      ));
      return {
        actorPtid,
        deviceId,
        active,
        availableKeyPackages:
          await imServiceV1.keyPackage.countAvailable(),
      };
    },

    async peerKeyBundleState({
      peerPtid,
      homeStationPeerId,
    }: {
      peerPtid: string;
      homeStationPeerId: string;
    }) {
      const response = await api.keyExchangeFetchBundle(
        peerPtid,
        undefined,
        homeStationPeerId,
      );
      return {
        peerPtid,
        bundleCount: response.bundles.length,
        deviceIds: response.bundles.map((bundle) => bundle.device_id),
      };
    },

    async revokeCurrentDevice() {
      const device = await api.messagingAcceptanceCurrentEndpoint(activeActorPtid());
      const deviceId = String(device?.device_id ?? '');
      if (!deviceId) {
        throw new Error('No active device is available for revocation');
      }
      const devices = await imServiceV1.device.list();
      const current = devices.find(entry => entry.ref?.deviceId === deviceId);
      if (!current || current.profileVersion <= 0n) {
        throw new Error('Current device profile version is unavailable');
      }
      await imServiceV1.device.revoke(deviceId, current.profileVersion);
      return {
        actorPtid: activeActorPtid(),
        deviceId,
        revoked: true,
      };
    },

    async dispatchRealtimeFrame({ eventId = '', dataB64 }: { eventId?: string; dataB64: string }) {
      dispatchRealtimeFrameForAcceptance({ event_id: eventId, data_b64: dataB64 });
      return { accepted: Boolean(dataB64) };
    },

    async callStart({ peerPtid, mediaKind }: { peerPtid: string; mediaKind: 'audio' | 'video' }) {
      const myPtid = activeActorPtid();
      await callP2p.startCall(myPtid, peerPtid, mediaKind);
      return { actorPtid: myPtid, peerPtid, mediaKind, started: true };
    },

    async callAccept({ peerPtid }: { peerPtid: string }) {
      const myPtid = activeActorPtid();
      await callP2p.acceptCall(myPtid, peerPtid);
      return { actorPtid: myPtid, peerPtid, accepted: true };
    },

    async callReject({ peerPtid }: { peerPtid: string }) {
      const myPtid = activeActorPtid();
      await callP2p.rejectCall(myPtid, peerPtid);
      return { actorPtid: myPtid, peerPtid, rejected: true };
    },

    async callEnd({ peerPtid }: { peerPtid: string }) {
      const myPtid = activeActorPtid();
      await callP2p.endCall(myPtid, peerPtid);
      return { actorPtid: myPtid, peerPtid, ended: true };
    },

    async callSnapshot({ peerPtid }: { peerPtid: string }) {
      const myPtid = activeActorPtid();
      const snapshot = acceptanceCallSnapshot(callP2p.getCall(myPtid, peerPtid));
      return { actorPtid: myPtid, peerPtid, snapshot };
    },

    async callToggleMic({ peerPtid, muted }: { peerPtid: string; muted: boolean }) {
      const myPtid = activeActorPtid();
      callP2p.toggleMic(myPtid, peerPtid, muted);
      const snapshot = acceptanceCallSnapshot(callP2p.getCall(myPtid, peerPtid));
      return { actorPtid: myPtid, peerPtid, snapshot };
    },

    async callToggleCamera({ peerPtid, off }: { peerPtid: string; off: boolean }) {
      const myPtid = activeActorPtid();
      callP2p.toggleCamera(myPtid, peerPtid, off);
      const snapshot = acceptanceCallSnapshot(callP2p.getCall(myPtid, peerPtid));
      return { actorPtid: myPtid, peerPtid, snapshot };
    },

    async callRestartConnection({ peerPtid }: { peerPtid: string }) {
      const myPtid = activeActorPtid();
      callP2p.restartCallConnection(myPtid, peerPtid);
      const snapshot = acceptanceCallSnapshot(callP2p.getCall(myPtid, peerPtid));
      return { actorPtid: myPtid, peerPtid, snapshot };
    },

    async callSwitchVideoDevice({ peerPtid }: { peerPtid: string }) {
      const myPtid = activeActorPtid();
      const before = callP2p.getCall(myPtid, peerPtid);
      const beforeTrackId = before?.localStream?.getVideoTracks()[0]?.id ?? '';
      const currentDeviceId = (
        before?.localStream?.getVideoTracks()[0]?.getSettings().deviceId
        ?? before?.videoDeviceId
        ?? ''
      );
      const devices = await callP2p.listMediaDevices();
      const selected = devices.videoInputs.find(
        (device) => device.deviceId !== currentDeviceId,
      );
      if (!selected) {
        return { actorPtid: myPtid, peerPtid, available: false, switched: false };
      }
      await callP2p.switchVideoDevice(myPtid, peerPtid, selected.deviceId);
      const after = callP2p.getCall(myPtid, peerPtid);
      const afterTrack = after?.localStream?.getVideoTracks()[0];
      return {
        actorPtid: myPtid,
        peerPtid,
        available: true,
        deviceCount: devices.videoInputs.length,
        switched: Boolean(beforeTrackId && afterTrack?.id && beforeTrackId !== afterTrack.id),
        newTrackLive: afterTrack?.readyState === 'live',
      };
    },

    async groupCallStart({
      groupUlid,
      mediaKind,
    }: {
      groupUlid: string;
      mediaKind: 'audio' | 'video';
    }) {
      await groupCallManager.joinGroupCall(groupUlid, mediaKind);
      return {
        actorPtid: activeActorPtid(),
        mediaKind,
        snapshot: groupCallManager.getSnapshot(),
      };
    },

    async groupCallLeave() {
      groupCallManager.leaveGroupCall();
      return {
        actorPtid: activeActorPtid(),
        snapshot: groupCallManager.getSnapshot(),
      };
    },

    async groupCallToggleMic({ enabled }: { enabled: boolean }) {
      await groupCallManager.setMicEnabled(enabled);
      return {
        actorPtid: activeActorPtid(),
        snapshot: groupCallManager.getSnapshot(),
      };
    },

    async groupCallToggleCamera({ enabled }: { enabled: boolean }) {
      await groupCallManager.setCameraEnabled(enabled);
      return {
        actorPtid: activeActorPtid(),
        snapshot: groupCallManager.getSnapshot(),
      };
    },

    async groupCallSnapshot() {
      return {
        actorPtid: activeActorPtid(),
        snapshot: groupCallManager.getSnapshot(),
      };
    },
  });
}
