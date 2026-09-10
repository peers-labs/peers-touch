// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMock = vi.hoisted(() => vi.fn());

vi.mock('./gatewayTypes', () => ({
  createGatewayTransport: () => ({ command: commandMock }),
}));

import type { MobileAuthSession } from '../../features/auth/authSession';
import { createGroupGateway } from './groupGateway';

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

describe('createGroupGateway canonical Conversation routes', () => {
  it('maps member reads and settings operations to direct canonical contracts', async () => {
    commandMock
      .mockResolvedValueOnce({
        ok: true,
        data: {
          members: [{
            conversation_id: 'conversation-1',
            ptid: 'bob',
            role: 2,
            nickname: 'Bobby',
            muted: true,
            invited_by_ptid: 'alice',
            actor_home_station_peer_id: 'station-peer',
            actor_home_station_domain: 'station.example',
          }],
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { success: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          settings: {
            nickname: 'Alice',
            muted: true,
            pinned: false,
            alert_enabled: false,
            background: 'mint',
            cleared_at_ms: 42,
          },
        },
      })
      .mockResolvedValueOnce({ ok: true, data: { success: true } });
    const gateway = createGroupGateway(session);

    const members = await gateway.listMembers('conversation-1');
    await gateway.updateMyNickname('conversation-1', 'Alice');
    const settings = await gateway.getMySettings('conversation-1');
    await gateway.updateMySettings('conversation-1', {
      isMuted: false,
      isPinned: true,
      alertEnabled: true,
      background: 'paper',
      clearedAt: 84,
    });

    expect(members).toEqual({
      ok: true,
      data: {
        members: [
          expect.objectContaining({
            groupUlid: 'conversation-1',
            ptid: 'bob',
            role: 2,
            nickname: 'Bobby',
            muted: true,
            invitedBy: 'alice',
            actorHomeStationPeerId: 'station-peer',
            actorHomeStationDomain: 'station.example',
          }),
        ],
        total: 1,
      },
    });
    expect(settings).toEqual({
      ok: true,
      data: {
        isMuted: true,
        isPinned: false,
        myNickname: 'Alice',
        showMemberNickname: false,
        alertEnabled: false,
        background: 'mint',
        clearedAt: 42,
      },
    });
    expect(commandMock.mock.calls.map(([request]) => request)).toEqual([
      {
        method: 'GET',
        path: '/conversation/members',
        query: { conversation_id: 'conversation-1' },
      },
      {
        method: 'PUT',
        path: '/conversation/member/settings',
        body: {
          conversation_id: 'conversation-1',
          settings: { nickname: 'Alice' },
        },
      },
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
            background: 'paper',
            cleared_at_ms: 84,
          },
        },
      },
    ]);
  });

  it('does not expose dead list/create or unsupported stats/offline compatibility calls', () => {
    const gateway = createGroupGateway(session);

    expect('createGroup' in gateway).toBe(false);
    expect('listGroups' in gateway).toBe(false);
    expect('getStats' in gateway).toBe(false);
    expect('getOfflineMessages' in gateway).toBe(false);
    expect('ackOfflineMessages' in gateway).toBe(false);
    expect('unreadCount' in gateway).toBe(false);
  });
});
