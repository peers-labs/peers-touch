import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MobileAuthSession } from '../auth/authSession';
import {
  MobileDurableCommandEnvelopeV2Schema,
  MobileDurableCommandState,
} from '../../gen/proto/domain/mobile/reliability_pb';
import { FriendRequestState } from '../../gen/proto/domain/social/relationship_pb';
import {
  listReliabilityCommands,
  readReliabilityRuntimeStatus,
  type CommandProjection,
} from '../../runtimes/commandRuntime';
import { messagingCreateDirect } from '../../services/mobileCommands';
import { createSocialGateway } from '../../services/gateways/socialGateway';
import { normalizeFriendRequest, normalizeSession } from './socialNormalizers';
import {
  projectAcceptedContacts,
  projectOutgoingRequests,
  projectPendingInboundRequests,
} from './socialProjection';
import { useSocialStore } from './socialStore';

vi.mock('../../services/mobileCommands', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../services/mobileCommands')>(),
  messagingCreateDirect: vi.fn(),
}));
vi.mock('../../runtimes/commandRuntime', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../runtimes/commandRuntime')>(),
  readReliabilityRuntimeStatus: vi.fn(),
  listReliabilityCommands: vi.fn(),
}));

const session: MobileAuthSession = {
  stationPeerId: 'station-a',
  stationUrl: 'https://station.example',
  sessionId: 'session-a',
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
};
const accepted = normalizeFriendRequest({
  requestId: 'request-a',
  senderPtid: 'ptid:alice',
  receiverPtid: 'ptid:bob',
  senderHomeStationPeerId: 'station-a',
  receiverHomeStationPeerId: 'station-a',
  receiverDisplayName: 'Bob',
  senderDisplayName: 'Alice',
  federationId: 'fed-a',
  status: FriendRequestState.ACCEPTED,
});

describe('Contacts relationship and Direct journey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSocialStore.setState(useSocialStore.getInitialState(), true);
    useSocialStore.setState({
      authSession: session,
      currentUserPtid: session.actorRef.ptid,
      socialGateway: createSocialGateway(session),
      friendRequests: [accepted],
      refreshSessions: vi.fn().mockResolvedValue(undefined),
    });
    vi.mocked(messagingCreateDirect).mockResolvedValue({
      conversationId: 'conversation-authoritative',
      commandId: 'command-direct',
      state: 'projected',
    });
  });

  it('projects accepted friends even when no conversation exists', () => {
    expect(useSocialStore.getState().sessions).toEqual([]);
    expect(projectAcceptedContacts([accepted], 'ptid:alice', {})).toEqual([{
      peerPtid: 'ptid:bob',
      peerName: 'Bob',
      peerAvatar: '',
      peerOnline: false,
      federationIds: ['fed-a'],
    }]);
    expect(projectOutgoingRequests([accepted], 'ptid:alice')).toEqual([]);
  });

  it('keeps inbound and outbound pending requests distinct from contacts', () => {
    const pending = { ...accepted, status: FriendRequestState.PENDING };
    expect(projectPendingInboundRequests([pending], 'ptid:bob')).toEqual([pending]);
    expect(projectOutgoingRequests([pending], 'ptid:bob')).toEqual([]);
    expect(projectOutgoingRequests([pending], 'ptid:alice')).toEqual([pending]);
    expect(projectAcceptedContacts([pending], 'ptid:bob', {})).toEqual([]);
  });

  it('projects incoming accepted peers and retains each accepted Federation scope', () => {
    expect(projectAcceptedContacts([
      accepted,
      { ...accepted, federationId: 'fed-b' },
      { ...accepted, federationId: 'fed-b' },
      { ...accepted, senderPtid: 'ptid:other', receiverPtid: 'ptid:another' },
    ], 'ptid:bob', { 'ptid:alice': true })).toEqual([{
      peerPtid: 'ptid:alice',
      peerName: 'Alice',
      peerAvatar: '',
      peerOnline: true,
      federationIds: ['fed-a', 'fed-b'],
    }]);
  });

  it('does not fabricate a Federation when the accepted projection lacks one', () => {
    expect(projectAcceptedContacts([{ ...accepted, federationId: '' }], 'ptid:alice', {})[0])
      .toMatchObject({ peerPtid: 'ptid:bob', federationIds: [] });
    expect(projectAcceptedContacts([accepted], null, {})).toEqual([]);
  });

  it('opens Direct through the native owner with the accepted Federation', async () => {
    useSocialStore.setState({
      refreshSessions: vi.fn().mockImplementation(async () => {
        useSocialStore.setState({ sessions: [normalizeSession({
          ulid: 'conversation-authoritative',
          participantAPtid: 'ptid:alice',
          participantBPtid: 'ptid:bob',
        })] });
      }),
    });
    await expect(useSocialStore.getState().openDirectConversation('ptid:bob', 'fed-a'))
      .resolves.toBe('conversation-authoritative');
    expect(messagingCreateDirect).toHaveBeenCalledWith({
      stationPeerId: 'station-a',
      actorPtid: 'ptid:alice',
      peerPtid: 'ptid:bob',
      federationId: 'fed-a',
    });
    expect(useSocialStore.getState().refreshSessions).toHaveBeenCalledOnce();
  });

  it('does not navigate before the native conversation projection is ready', async () => {
    await expect(useSocialStore.getState().openDirectConversation('ptid:bob', 'fed-a'))
      .rejects.toThrow('mobile.contacts.conversationPreparing');
    expect(useSocialStore.getState().sessions).toEqual([]);
  });

  it('does not open a conversation with an unaccepted or guessed scope', async () => {
    await expect(useSocialStore.getState().openDirectConversation('ptid:bob', 'guessed'))
      .rejects.toThrow('mobile.contacts.federationRequired');
    useSocialStore.setState({ friendRequests: [{ ...accepted, status: FriendRequestState.PENDING }] });
    await expect(useSocialStore.getState().openDirectConversation('ptid:bob', 'fed-a'))
      .rejects.toThrow('mobile.contacts.federationRequired');
    expect(messagingCreateDirect).not.toHaveBeenCalled();
  });

  it('does not return a conversation ID to a replacement account', async () => {
    vi.mocked(messagingCreateDirect).mockImplementation(async () => {
      useSocialStore.setState({ authSession: { ...session, sessionId: 'replacement' } });
      return { conversationId: 'old-scope', commandId: 'command', state: 'projected' };
    });
    await expect(useSocialStore.getState().openDirectConversation('ptid:bob', 'fed-a'))
      .rejects.toThrow('mobile.social.notAuthenticated');
    expect(useSocialStore.getState().refreshSessions).not.toHaveBeenCalled();
  });

  it('rejects an empty conversation ID instead of navigating to an invented session', async () => {
    vi.mocked(messagingCreateDirect).mockResolvedValue({
      conversationId: '', commandId: 'command', state: 'pending',
    });
    await expect(useSocialStore.getState().openDirectConversation('ptid:bob', 'fed-a'))
      .rejects.toThrow('mobile.contacts.openChatFailed');
  });

  it.each(['acceptFriendRequest', 'rejectFriendRequest'] as const)(
    '%s never invents a terminal relationship from an unresolved command',
    async (action) => {
      const request = { ...accepted, status: FriendRequestState.PENDING };
      const gateway = createSocialGateway(session);
      vi.spyOn(gateway, action).mockResolvedValue({
        ok: true,
        data: {
          command: {
            commandId: 'command',
            requestId: request.requestId,
            payloadSha256: [],
            state: 'unknown-outcome',
            checkpointReady: false,
          },
        },
      });
      useSocialStore.setState({
        authSession: { ...session, actorRef: { ptid: 'ptid:bob' } },
        currentUserPtid: 'ptid:bob',
        socialGateway: gateway,
        friendRequests: [request],
      });
      await expect(useSocialStore.getState()[action](request.requestId))
        .rejects.toThrow('mobile.contacts.requestUnconfirmed');
      expect(useSocialStore.getState().friendRequests).toEqual([request]);
    },
  );

  it('preserves an unresolved native command instead of creating a duplicate', async () => {
    const gateway = useSocialStore.getState().socialGateway!;
    const send = vi.spyOn(gateway, 'sendFriendRequest');
    vi.mocked(readReliabilityRuntimeStatus).mockResolvedValue({
      active: true, stationPeerId: 'station-a', actorPtid: 'ptid:alice',
      runtimeGeneration: 1, admissionOpen: true, pendingCommands: 0,
      unknownCommands: 1, draftCount: 0, archivedLegacyFiles: 0,
      commandCapacity: {
        recordCount: 1,
        recordLimit: 512,
        byteUsage: 1024,
        byteLimit: 16_777_216,
        exhaustionCauses: [],
      },
    });
    const command: CommandProjection = {
      commandId: 'existing-command', orderingKey: 'peer-bob', state: 'unknown-outcome',
      attemptCount: 1, typedLastError: 5, createdAtMs: 1, updatedAtMs: 2, nextAttemptAtMs: null,
      envelope: create(MobileDurableCommandEnvelopeV2Schema, {
        state: MobileDurableCommandState.UNRESOLVED,
        payload: { case: 'friendRequest', value: { body: {
          federationId: 'fed-a', sender: { ptid: 'ptid:alice' }, receiver: { ptid: 'ptid:bob' },
        } } },
      }),
    };
    vi.mocked(listReliabilityCommands).mockResolvedValue([command]);
    await expect(useSocialStore.getState().sendFriendRequest('ptid:bob', 'station-a', 'fed-a'))
      .rejects.toThrow('mobile.contacts.requestUnconfirmed');
    expect(send).not.toHaveBeenCalled();
    expect(listReliabilityCommands).toHaveBeenCalledWith('station-a', 'ptid:alice', 1);
  });

  it('fences overlapping send intent before asynchronous ledger inspection', async () => {
    let resolveStatus!: (value: Awaited<ReturnType<typeof readReliabilityRuntimeStatus>>) => void;
    vi.mocked(readReliabilityRuntimeStatus).mockReturnValue(new Promise((resolve) => {
      resolveStatus = resolve;
    }));
    const first = useSocialStore.getState().sendFriendRequest('ptid:bob', 'station-a', 'fed-a');
    await expect(useSocialStore.getState().sendFriendRequest('ptid:bob', 'station-a', 'fed-a'))
      .rejects.toThrow('mobile.contacts.requestUnconfirmed');
    expect(readReliabilityRuntimeStatus).toHaveBeenCalledOnce();
    resolveStatus({
      active: false, runtimeGeneration: 0, admissionOpen: false,
      pendingCommands: 0, unknownCommands: 0, draftCount: 0, archivedLegacyFiles: 0,
      commandCapacity: {
        recordCount: 0,
        recordLimit: 512,
        byteUsage: 0,
        byteLimit: 16_777_216,
        exhaustionCauses: [],
      },
    });
    await expect(first).rejects.toThrow('mobile.social.notAuthenticated');
  });
});
