// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile production bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const commandMock = vi.hoisted(() => vi.fn());
const dissolveConversationMock = vi.hoisted(() => vi.fn());
const membershipTransitionMock = vi.hoisted(() => vi.fn());
const submitLeaveIntentMock = vi.hoisted(() => vi.fn());
const transferOwnershipMock = vi.hoisted(() => vi.fn());
const updateConversationMock = vi.hoisted(() => vi.fn());
const updateMemberAuthorityMock = vi.hoisted(() => vi.fn());

vi.mock('./gatewayTypes', () => ({
  createGatewayTransport: () => ({ command: commandMock }),
}));
vi.mock('../mobileCommands', () => ({
  messagingDissolveConversation: dissolveConversationMock,
  messagingMembershipTransition: membershipTransitionMock,
  messagingSubmitLeaveIntent: submitLeaveIntentMock,
  messagingTransferOwnership: transferOwnershipMock,
  messagingUpdateConversation: updateConversationMock,
  messagingUpdateMemberAuthority: updateMemberAuthorityMock,
}));

import type { MobileAuthSession } from '../../features/auth/authSession';
import { createGroupGateway } from './groupGateway';

const session = {
  stationPeerId: 'station-peer',
  stationUrl: 'https://station.example',
  sessionId: 'session',
  actorRef: { ptid: 'alice' },
  authenticatedAt: 1,
} satisfies MobileAuthSession;

beforeEach(() => {
  commandMock.mockReset();
  dissolveConversationMock.mockReset();
  membershipTransitionMock.mockReset();
  submitLeaveIntentMock.mockReset();
  transferOwnershipMock.mockReset();
  updateConversationMock.mockReset();
  updateMemberAuthorityMock.mockReset();
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

  it('routes name/description update and dissolve through the Device Messaging Engine', async () => {
    updateConversationMock.mockResolvedValue({
      commandId: 'update-command',
      state: 'pending',
    });
    dissolveConversationMock.mockResolvedValue({
      commandId: 'dissolve-command',
      state: 'pending',
    });
    const gateway = createGroupGateway(session);

    await expect(gateway.updateGroup('conversation-1', {
      name: 'Updated group',
      description: '',
    })).resolves.toEqual({
      ok: true,
      data: {
        command: { commandId: 'update-command', state: 'pending' },
      },
    });
    await expect(gateway.dissolveGroup('conversation-1')).resolves.toEqual({
      ok: true,
      data: {
        command: { commandId: 'dissolve-command', state: 'pending' },
      },
    });

    expect(updateConversationMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      conversationId: 'conversation-1',
      name: 'Updated group',
      description: '',
    });
    expect(dissolveConversationMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      conversationId: 'conversation-1',
    });
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('fails group-wide mute visibly without invoking any fallback', async () => {
    const gateway = createGroupGateway(session);

    await expect(gateway.updateGroup('conversation-1', { muted: true })).resolves.toEqual({
      ok: false,
      error: {
        code: 'GROUP_WIDE_MUTE_OWNER_BLOCKED',
        message: 'mobile.group.operationUpdateFailed',
        method: 'INVOKE',
        path: 'messaging_update_conversation',
      },
    });

    expect(updateConversationMock).not.toHaveBeenCalled();
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('routes member add and removal through the Device Messaging Engine', async () => {
    membershipTransitionMock.mockResolvedValue({
      commandId: 'command-1',
      state: 'pending',
    });
    const gateway = createGroupGateway(session);

    await expect(
      gateway.inviteMembers('conversation-1', ['ptid:bob', 'ptid:carol']),
    ).resolves.toEqual({
      ok: true,
      data: {
        commands: [
          { commandId: 'command-1', state: 'pending' },
          { commandId: 'command-1', state: 'pending' },
        ],
      },
    });
    await expect(
      gateway.removeMember('conversation-1', 'ptid:bob'),
    ).resolves.toEqual({
      ok: true,
      data: {
        commands: [{ commandId: 'command-1', state: 'pending' }],
      },
    });

    expect(membershipTransitionMock.mock.calls.map(([input]) => input)).toEqual([
      {
        stationPeerId: 'station-peer',
        actorPtid: 'alice',
        conversationId: 'conversation-1',
        action: 'add_actor',
        targetPtid: 'ptid:bob',
        role: 'member',
      },
      {
        stationPeerId: 'station-peer',
        actorPtid: 'alice',
        conversationId: 'conversation-1',
        action: 'add_actor',
        targetPtid: 'ptid:carol',
        role: 'member',
      },
      {
        stationPeerId: 'station-peer',
        actorPtid: 'alice',
        conversationId: 'conversation-1',
        action: 'remove_actor',
        targetPtid: 'ptid:bob',
      },
    ]);
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('submits self-leave through the signed Core leave-intent flow', async () => {
    submitLeaveIntentMock.mockResolvedValue({
      intentId: 'leave-intent-1',
      state: 'pending',
    });
    const gateway = createGroupGateway(session);

    await expect(gateway.leaveGroup('conversation-1')).resolves.toEqual({
      ok: true,
      data: {
        intentId: 'leave-intent-1',
        state: 'pending',
      },
    });
    expect(submitLeaveIntentMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      conversationId: 'conversation-1',
    });
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('updates member authority through the projected native Conversation command', async () => {
    updateMemberAuthorityMock.mockResolvedValue({
      commandId: 'authority-command',
      conversationId: 'conversation-1',
      ownerPtid: 'ptid:alice',
      members: [
        {
          ptid: 'ptid:bob',
          role: 2,
          homeStationPeerId: 'station-peer',
          muted: true,
          mutedUntilUnixMs: 84,
        },
      ],
      authoritySequence: 4,
      authorityHash: Array(32).fill(7),
      membershipEpoch: 3,
      mlsEpoch: 2,
      state: 'projected',
    });
    const gateway = createGroupGateway(session);

    await expect(gateway.updateMember('conversation-1', 'ptid:bob', {
      role: 2,
      muted: true,
      mutedUntil: 84,
    })).resolves.toEqual({
      ok: true,
      data: {
        authority: expect.objectContaining({
          commandId: 'authority-command',
          state: 'projected',
          authoritySequence: 4,
          membershipEpoch: 3,
          mlsEpoch: 2,
        }),
      },
    });
    expect(updateMemberAuthorityMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      conversationId: 'conversation-1',
      targetPtid: 'ptid:bob',
      role: 'admin',
      muted: true,
      mutedUntilUnixMs: 84,
    });
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('keeps a remotely forwarded member-authority command pending until projection', async () => {
    updateMemberAuthorityMock.mockResolvedValue({
      commandId: 'authority-command',
      conversationId: 'conversation-1',
      state: 'pending',
    });
    const gateway = createGroupGateway(session);

    await expect(gateway.updateMember('conversation-1', 'ptid:bob', {
      muted: true,
    })).resolves.toEqual({
      ok: true,
      data: {
        authority: {
          commandId: 'authority-command',
          conversationId: 'conversation-1',
          state: 'pending',
        },
      },
    });
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('transfers ownership atomically through the projected native command', async () => {
    transferOwnershipMock.mockResolvedValue({
      commandId: 'owner-command',
      conversationId: 'conversation-1',
      ownerPtid: 'ptid:bob',
      members: [],
      authoritySequence: 5,
      authorityHash: Array(32).fill(8),
      membershipEpoch: 4,
      mlsEpoch: 2,
      state: 'projected',
    });
    const gateway = createGroupGateway(session);

    await expect(
      gateway.transferOwnership('conversation-1', 'ptid:bob'),
    ).resolves.toEqual({
      ok: true,
      data: {
        authority: expect.objectContaining({
          commandId: 'owner-command',
          ownerPtid: 'ptid:bob',
          state: 'projected',
        }),
      },
    });
    expect(transferOwnershipMock).toHaveBeenCalledWith({
      stationPeerId: 'station-peer',
      actorPtid: 'alice',
      conversationId: 'conversation-1',
      nextOwnerPtid: 'ptid:bob',
    });
    expect(updateMemberAuthorityMock).not.toHaveBeenCalled();
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('preserves typed Conversation owner failures without a legacy fallback', async () => {
    updateMemberAuthorityMock.mockRejectedValue({
      code: 'CONVERSATION_OWNER_PROTECTED',
      message: 'owner authority can only change through ownership transfer',
    });
    const gateway = createGroupGateway(session);

    await expect(
      gateway.updateMember('conversation-1', 'ptid:alice', { role: 2 }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONVERSATION_OWNER_PROTECTED',
        message: 'owner authority can only change through ownership transfer',
        method: 'INVOKE',
        path: 'messaging_update_member_authority',
      },
    });
    expect(commandMock).not.toHaveBeenCalled();
  });

  it('returns a typed self-leave failure without falling back to the retired route', async () => {
    submitLeaveIntentMock.mockRejectedValue(new Error('leave rejected'));
    const gateway = createGroupGateway(session);

    await expect(gateway.leaveGroup('conversation-1')).resolves.toEqual({
      ok: false,
      error: {
        code: 'GROUP_SELF_LEAVE_INTENT_FAILED',
        message: 'leave rejected',
        method: 'INVOKE',
        path: 'messaging_submit_leave_intent',
      },
    });
    expect(commandMock).not.toHaveBeenCalled();
  });
});
