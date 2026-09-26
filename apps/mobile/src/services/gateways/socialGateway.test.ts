// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMock = vi.hoisted(() => vi.fn());
const friendRequestSendMock = vi.hoisted(() => vi.fn());
const friendRequestAcceptMock = vi.hoisted(() => vi.fn());
const friendRequestRejectMock = vi.hoisted(() => vi.fn());
const relationshipBlockMock = vi.hoisted(() => vi.fn());
const relationshipUnblockMock = vi.hoisted(() => vi.fn());

vi.mock('./gatewayTypes', () => ({
  createGatewayTransport: () => ({ command: commandMock }),
  decodeProtoJsonOutcome: (outcome: unknown) => outcome,
}));
vi.mock('../mobileCommands', () => ({
  socialFriendRequestSend: friendRequestSendMock,
  socialFriendRequestAccept: friendRequestAcceptMock,
  socialFriendRequestReject: friendRequestRejectMock,
  socialRelationshipBlock: relationshipBlockMock,
  socialRelationshipUnblock: relationshipUnblockMock,
}));

import type { MobileAuthSession } from '../../features/auth/authSession';
import { createSocialGateway } from './socialGateway';

const session = {
  stationPeerId: 'station-peer',
  stationUrl: 'https://station.example',
  sessionId: 'session',
  actorRef: { ptid: 'alice' },
  authenticatedAt: 1,
} satisfies MobileAuthSession;

beforeEach(() => {
  commandMock.mockReset();
  relationshipBlockMock.mockReset();
  relationshipUnblockMock.mockReset();
});

describe('createSocialGateway Friend Request routes', () => {
  it('routes Friend Request writes through the Mobile Rust signer', async () => {
    commandMock.mockResolvedValue({ ok: true, data: {} });
    friendRequestSendMock.mockResolvedValue({});
    friendRequestAcceptMock.mockResolvedValue({});
    friendRequestRejectMock.mockResolvedValue({});
    const gateway = createSocialGateway(session);
    const request = {
      requestId: 'request-id',
      federationId: 'federation-1',
      senderPtid: 'ptid:alice',
      receiverPtid: 'ptid:bob',
      senderHomeStationPeerId: 'station-a',
      receiverHomeStationPeerId: 'station-peer',
    };

    await gateway.listFriendRequests(2, 25, 5);
    await gateway.sendFriendRequest('ptid:bob', 'station-b', 'federation-1', 'hello');
    await gateway.acceptFriendRequest(request);
    await gateway.rejectFriendRequest(request);

    expect(commandMock.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'GET',
        path: '/api/v1/social/friend-requests',
        query: { state: 2, limit: 25, offset: 5 },
      },
    ]);
    expect(friendRequestSendMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      receiverPtid: 'ptid:bob',
      receiverHomeStationPeerId: 'station-b',
      federationId: 'federation-1',
      message: 'hello',
    });
    expect(friendRequestAcceptMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      ...request,
    });
    expect(friendRequestRejectMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      ...request,
    });
  });

  it('uses the canonical Conversation member settings routes and readback', async () => {
    commandMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          settings: {
            muted: true,
            pinned: false,
            alert_enabled: false,
            background: 'paper',
          },
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { success: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          settings: {
            muted: false,
            pinned: true,
            alert_enabled: true,
            background: 'dusk',
          },
        },
      });
    const gateway = createSocialGateway(session);

    const initial = await gateway.getConversationSettings('conversation-1');
    const updated = await gateway.updateConversationSettings('conversation-1', {
      isMuted: false,
      isPinned: true,
      alertEnabled: true,
      background: 'dusk',
    });

    expect(initial).toEqual({
      ok: true,
      data: {
        sessionUlid: 'conversation-1',
        isMuted: true,
        isPinned: false,
        alertEnabled: false,
        background: 'paper',
      },
    });
    expect(updated).toEqual({
      ok: true,
      data: {
        sessionUlid: 'conversation-1',
        isMuted: false,
        isPinned: true,
        alertEnabled: true,
        background: 'dusk',
      },
    });
    expect(commandMock.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'GET',
        path: '/conversation/member/settings',
        query: { conversation_id: 'conversation-1' },
      },
      {
        method: 'PUT',
        path: '/conversation/member/settings',
        body: {
          conversation_id: 'conversation-1',
          settings: {
            muted: false,
            pinned: true,
            alert_enabled: true,
            background: 'dusk',
          },
        },
      },
      {
        method: 'GET',
        path: '/conversation/member/settings',
        query: { conversation_id: 'conversation-1' },
      },
    ]);
  });

  it('does not expose the retired friend-chat session compatibility methods', () => {
    const gateway = createSocialGateway(session);

    expect('listSessions' in gateway).toBe(false);
    expect('createSession' in gateway).toBe(false);
  });

  it('uses generated Social relationship commands and canonical read routes', async () => {
    relationshipBlockMock.mockResolvedValue({
      commandId: 'block-command',
      targetPtid: 'ptid:bob',
      payloadSha256: [1, 2, 3],
      state: 'committed',
      checkpointReady: true,
      response: {
        result: {
          projection: {
            targetActor: { ptid: 'ptid:bob' },
            targetHomeStationPeerId: 'station-b',
            blockedByViewer: true,
            interactionAllowed: false,
            revision: 2n,
            allowedActions: [],
          },
        },
      },
    });
    relationshipUnblockMock.mockResolvedValue({
      commandId: 'unblock-command',
      targetPtid: 'ptid:bob',
      payloadSha256: [4, 5, 6],
      state: 'committed',
      checkpointReady: true,
      response: {
        result: {
          projection: {
            targetActor: { ptid: 'ptid:bob' },
            targetHomeStationPeerId: 'station-b',
            blockedByViewer: false,
            interactionAllowed: true,
            revision: 3n,
            allowedActions: [1, 2, 3, 4],
          },
        },
      },
    });
    commandMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [{
            actor: { ptid: 'ptid:bob' },
            homeStationPeerId: 'station-b',
            revision: 2n,
          }],
          nextCursor: '',
          revision: 2n,
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          relationship: {
            targetActor: { ptid: 'ptid:bob' },
            targetHomeStationPeerId: 'station-b',
            blockedByViewer: true,
            interactionAllowed: false,
            revision: 2n,
            allowedActions: [],
          },
        },
      });
    const gateway = createSocialGateway(session);

    await gateway.blockUser('ptid:bob', 'station-b', 1);
    await gateway.unblockUser('ptid:bob', 'station-b', 2);
    await gateway.listBlockedUsers(25, 'cursor-1');
    const status = await gateway.getFriendshipStatus('ptid:bob');

    expect(relationshipBlockMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      targetPtid: 'ptid:bob',
      targetHomeStationPeerId: 'station-b',
      observedRevision: 1,
    });
    expect(relationshipUnblockMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      targetPtid: 'ptid:bob',
      targetHomeStationPeerId: 'station-b',
      observedRevision: 2,
    });
    expect(commandMock.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'GET',
        path: '/api/v1/social/relationships/blocked',
        query: { limit: 25, cursor: 'cursor-1' },
      },
      {
        method: 'GET',
        path: '/api/v1/social/relationships/status',
        query: { target_ptid: 'ptid:bob' },
      },
    ]);
    expect(status).toMatchObject({
      ok: true,
      data: {
        targetPtid: 'ptid:bob',
        targetHomeStationPeerId: 'station-b',
        blocked: true,
        interactionAllowed: false,
        revision: 2,
      },
    });
  });
});
