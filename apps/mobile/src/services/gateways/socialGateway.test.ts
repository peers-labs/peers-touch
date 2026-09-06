// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { describe, expect, it, vi } from 'vitest';

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
});
