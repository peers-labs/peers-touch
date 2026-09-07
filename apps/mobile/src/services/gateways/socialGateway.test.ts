// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMock = vi.hoisted(() => vi.fn());

vi.mock('./gatewayTypes', () => ({
  createGatewayTransport: () => ({ command: commandMock }),
}));

import type { MobileAuthSession } from '../../features/auth/authSession';
import { createSocialGateway } from './socialGateway';

const session = {
  stationPeerId: 'station-peer',
  stationUrl: 'https://station.example',
  sessionId: 'session',
  accessToken: 'token',
  actorRef: { ptid: 'alice' },
  authenticatedAt: 1,
} satisfies MobileAuthSession;

beforeEach(() => {
  commandMock.mockReset();
});

describe('createSocialGateway Friend Request routes', () => {
  it('maps Friend Request operations to the Station Social owner', async () => {
    commandMock.mockResolvedValue({ ok: true, data: {} });
    const gateway = createSocialGateway(session);

    await gateway.listFriendRequests(2, 25, 5);
    await gateway.sendFriendRequest('bob', 'hello');
    await gateway.acceptFriendRequest('accept-id');
    await gateway.rejectFriendRequest('reject-id');

    expect(commandMock.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'GET',
        path: '/api/v1/social/friend-requests',
        query: { status: 2, limit: 25, offset: 5 },
      },
      {
        method: 'POST',
        path: '/api/v1/social/friend-request/send',
        body: { receiver_ptid: 'bob', message: 'hello' },
      },
      {
        method: 'POST',
        path: '/api/v1/social/friend-request/accept',
        body: { request_id: 'accept-id' },
      },
      {
        method: 'POST',
        path: '/api/v1/social/friend-request/reject',
        body: { request_id: 'reject-id' },
      },
    ]);
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
            cleared_at_ms: 42,
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
            cleared_at_ms: 84,
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
      clearedAt: 84,
    });

    expect(initial).toEqual({
      ok: true,
      data: {
        sessionUlid: 'conversation-1',
        isMuted: true,
        isPinned: false,
        alertEnabled: false,
        background: 'paper',
        clearedAt: 42,
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
        clearedAt: 84,
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
            cleared_at_ms: 84,
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
});
