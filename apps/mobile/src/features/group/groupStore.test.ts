// @ts-nocheck -- Vitest is supplied by the repository test runner, not the Mobile bundle.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const listConversationsMock = vi.hoisted(() => vi.fn());
const createGroupMock = vi.hoisted(() => vi.fn());
const updateGroupMock = vi.hoisted(() => vi.fn());
const dissolveGroupMock = vi.hoisted(() => vi.fn());
const leaveGroupMock = vi.hoisted(() => vi.fn());
const getMySettingsMock = vi.hoisted(() => vi.fn());
const inviteMembersMock = vi.hoisted(() => vi.fn());
const listMembersMock = vi.hoisted(() => vi.fn());
const removeMemberMock = vi.hoisted(() => vi.fn());
const transferOwnershipMock = vi.hoisted(() => vi.fn());
const updateMemberMock = vi.hoisted(() => vi.fn());
const commandStatusMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/mobileCommands', () => ({
  messagingCommandStatus: commandStatusMock,
  messagingConversationSummary: vi.fn(),
  messagingCreateGroup: createGroupMock,
  messagingListConversations: listConversationsMock,
  messagingListMessages: vi.fn(),
  messagingListThreadMessages: vi.fn(),
  messagingSendMessage: vi.fn(),
  messagingSubmitEdit: vi.fn(),
  messagingSubmitMetadataInteraction: vi.fn(),
  messagingSubmitReadCursor: vi.fn(),
}));

vi.mock('../../services/gateways', () => ({
  createGroupGateway: () => ({
    dissolveGroup: dissolveGroupMock,
    getMySettings: getMySettingsMock,
    inviteMembers: inviteMembersMock,
    leaveGroup: leaveGroupMock,
    listMembers: listMembersMock,
    removeMember: removeMemberMock,
    transferOwnership: transferOwnershipMock,
    updateGroup: updateGroupMock,
    updateMember: updateMemberMock,
  }),
  unwrapOutcome: (outcome: { ok: boolean; data?: unknown; error?: unknown }) => {
    if (!outcome.ok) throw outcome.error;
    return outcome.data;
  },
}));

import type { MobileAuthSession } from '../auth/authSession';
import { useGroupStore } from './groupStore';

const session = {
  stationPeerId: 'station-peer',
  stationUrl: 'https://station.example',
  sessionId: 'session',
  deviceId: 'device-1',
  lifecycleGeneration: 1,
  actorRef: { ptid: 'ptid:alice' },
  authenticatedAt: 1,
} satisfies MobileAuthSession;

function conversation(name: string, description: string, active = true) {
  return {
    conversationId: 'conversation-1',
    authorityStationId: 'station-authority',
    federationId: 'federation-1',
    kind: 2,
    name,
    description,
    ownerPtid: 'ptid:alice',
    memberPtids: ['ptid:alice', 'ptid:bob'],
    membershipEpoch: 1,
    mlsEpoch: 1,
    active,
    updatedAtUnixMs: 10,
  };
}

beforeEach(() => {
  listConversationsMock.mockReset().mockResolvedValue([
    conversation('Existing group', 'Existing description'),
  ]);
  createGroupMock.mockReset();
  updateGroupMock.mockReset();
  dissolveGroupMock.mockReset();
  leaveGroupMock.mockReset();
  inviteMembersMock.mockReset();
  listMembersMock.mockReset().mockResolvedValue({
    ok: true,
    data: { members: [], total: 0 },
  });
  removeMemberMock.mockReset();
  transferOwnershipMock.mockReset();
  updateMemberMock.mockReset();
  commandStatusMock.mockReset().mockResolvedValue({
    commandId: 'membership-command',
    conversationId: 'conversation-1',
    state: 'pending',
    lastErrorCode: '',
  });
  getMySettingsMock.mockReset().mockResolvedValue({
    ok: true,
    data: {
      isMuted: false,
      isPinned: false,
      myNickname: '',
      showMemberNickname: false,
      alertEnabled: true,
      background: '',
      clearedAt: 0,
    },
  });
  useGroupStore.getState().bindSession(null);
  useGroupStore.getState().bindSession(session);
});

describe('Group store canonical Conversation mutation readback', () => {
  it('does not synthesize an active group while create remains pending', async () => {
    let conversationId = '';
    createGroupMock.mockImplementation(async (input) => {
      conversationId = input.conversationId;
      return {
        conversationId,
        commandId: 'create-command',
        state: 'pending',
      };
    });

    await expect(useGroupStore.getState().createGroup({
      name: 'Pending group',
      description: 'Pending description',
      initialMemberPtids: ['ptid:bob'],
      federationId: 'federation-1',
    })).resolves.toBeNull();
    expect(useGroupStore.getState().groups).toEqual([]);
    expect(useGroupStore.getState().groupCreateOperation).toMatchObject({
      conversationId,
      commandId: 'create-command',
      name: 'Pending group',
      description: 'Pending description',
      initialMemberPtids: ['ptid:bob'],
      federationId: 'federation-1',
      phase: 'pending',
    });

    listConversationsMock.mockResolvedValueOnce([{
      ...conversation('Pending group', 'Pending description'),
      conversationId,
    }]);
    await useGroupStore.getState().refreshGroups();

    expect(useGroupStore.getState().groups).toHaveLength(1);
    expect(useGroupStore.getState().groups[0]).toMatchObject({
      ulid: conversationId,
      name: 'Pending group',
      description: 'Pending description',
    });
    expect(useGroupStore.getState().groupCreateOperation?.phase).toBe('pending');

    useGroupStore.getState().clearGroupCreateOperation(conversationId);
    expect(useGroupStore.getState().groupCreateOperation).toBeNull();
  });

  it('retains failed create identity and input for explicit recovery', async () => {
    createGroupMock.mockImplementation(async (input) => ({
      conversationId: input.conversationId,
      commandId: 'failed-create-command',
      state: 'failed',
    }));

    await expect(useGroupStore.getState().createGroup({
      name: 'Retry group',
      description: 'Keep this input',
      initialMemberPtids: ['ptid:bob'],
      federationId: 'federation-1',
    })).rejects.toThrow('mobile.group.operationCreateFailed');

    expect(useGroupStore.getState().groupCreateOperation).toMatchObject({
      commandId: 'failed-create-command',
      name: 'Retry group',
      description: 'Keep this input',
      initialMemberPtids: ['ptid:bob'],
      phase: 'failed',
    });
  });

  it('retains a pending leave until the Engine projection removes the group', async () => {
    listConversationsMock.mockResolvedValueOnce([
      conversation('Existing group', 'Existing description'),
    ]);
    await useGroupStore.getState().refreshGroups();
    useGroupStore.setState({
      activeGroupUlid: 'conversation-1',
      members: { 'conversation-1': [] },
      messages: { 'conversation-1': [] },
      unreadCounts: { 'conversation-1': 2 },
    });
    leaveGroupMock.mockResolvedValue({
      ok: true,
      data: { intentId: 'leave-intent', state: 'pending' },
    });

    await useGroupStore.getState().leaveGroup('conversation-1');

    expect(useGroupStore.getState()).toMatchObject({
      activeGroupUlid: 'conversation-1',
      members: { 'conversation-1': [] },
      messages: { 'conversation-1': [] },
      unreadCounts: { 'conversation-1': 2 },
    });
    expect(useGroupStore.getState().groups).toHaveLength(1);

    listConversationsMock.mockResolvedValueOnce([]);
    await useGroupStore.getState().refreshGroups();

    expect(useGroupStore.getState()).toMatchObject({
      activeGroupUlid: null,
      members: {},
      messages: {},
      unreadCounts: {},
    });
    expect(useGroupStore.getState().groups).toEqual([]);
  });

  it('keeps update and dissolve pending until the Engine projection changes', async () => {
    listConversationsMock.mockResolvedValueOnce([
      conversation('Original', 'Original description'),
    ]);
    await useGroupStore.getState().refreshGroups();

    updateGroupMock.mockResolvedValue({
      ok: true,
      data: { command: { commandId: 'update-command', state: 'pending' } },
    });
    listConversationsMock.mockResolvedValueOnce([
      conversation('Original', 'Original description'),
    ]);
    await useGroupStore.getState().updateGroup('conversation-1', {
      name: 'Renamed',
      description: 'Updated description',
    });
    expect(useGroupStore.getState().groups[0]).toMatchObject({
      name: 'Original',
      description: 'Original description',
    });

    listConversationsMock.mockResolvedValueOnce([
      conversation('Renamed', 'Updated description'),
    ]);
    await useGroupStore.getState().refreshGroups();
    expect(useGroupStore.getState().groups[0]).toMatchObject({
      name: 'Renamed',
      description: 'Updated description',
    });

    dissolveGroupMock.mockResolvedValue({
      ok: true,
      data: { command: { commandId: 'dissolve-command', state: 'pending' } },
    });
    listConversationsMock.mockResolvedValueOnce([
      conversation('Renamed', 'Updated description'),
    ]);
    await useGroupStore.getState().dissolveGroup('conversation-1');
    expect(useGroupStore.getState().groups).toHaveLength(1);

    listConversationsMock.mockResolvedValueOnce([]);
    await useGroupStore.getState().refreshGroups();
    expect(useGroupStore.getState().groups).toEqual([]);
  });
});

describe('Group member authority projection readback', () => {
  it('reloads canonical member and Conversation projections after role update', async () => {
    updateMemberMock.mockResolvedValue({
      ok: true,
      data: {
        authority: {
          commandId: 'authority-command',
          state: 'projected',
        },
      },
    });
    listMembersMock.mockResolvedValueOnce({
      ok: true,
      data: {
        members: [{
          groupUlid: 'conversation-1',
          ptid: 'ptid:bob',
          role: 2,
        }],
        total: 1,
      },
    });
    listConversationsMock.mockResolvedValueOnce([
      {
        ...conversation('Existing group', 'Existing description'),
        membershipEpoch: 2,
      },
    ]);

    await useGroupStore.getState().updateMember(
      'conversation-1',
      'ptid:bob',
      { role: 2 },
    );

    expect(updateMemberMock).toHaveBeenCalledWith(
      'conversation-1',
      'ptid:bob',
      { role: 2 },
    );
    expect(useGroupStore.getState().members['conversation-1'][0]).toMatchObject({
      ptid: 'ptid:bob',
      role: 2,
    });
    expect(useGroupStore.getState().groups[0].membershipEpoch).toBe(2n);
  });

  it('reloads the atomic owner and complete member readback after transfer', async () => {
    transferOwnershipMock.mockResolvedValue({
      ok: true,
      data: {
        authority: {
          commandId: 'owner-command',
          state: 'projected',
        },
      },
    });
    listMembersMock.mockResolvedValueOnce({
      ok: true,
      data: {
        members: [
          { groupUlid: 'conversation-1', ptid: 'ptid:alice', role: 2 },
          { groupUlid: 'conversation-1', ptid: 'ptid:bob', role: 3 },
        ],
        total: 2,
      },
    });
    listConversationsMock.mockResolvedValueOnce([
      {
        ...conversation('Existing group', 'Existing description'),
        ownerPtid: 'ptid:bob',
        membershipEpoch: 2,
      },
    ]);

    await useGroupStore.getState().transferOwnership(
      'conversation-1',
      'ptid:bob',
    );

    expect(transferOwnershipMock).toHaveBeenCalledWith(
      'conversation-1',
      'ptid:bob',
    );
    expect(useGroupStore.getState().groups[0]).toMatchObject({
      ownerPtid: 'ptid:bob',
      membershipEpoch: 2n,
    });
    expect(useGroupStore.getState().members['conversation-1']).toEqual([
      expect.objectContaining({ ptid: 'ptid:alice', role: 2 }),
      expect.objectContaining({ ptid: 'ptid:bob', role: 3 }),
    ]);
  });
});

describe('Group membership command convergence', () => {
  it('fences duplicate add dispatch and stays pending until member readback appears', async () => {
    let releaseInvite!: (value: unknown) => void;
    inviteMembersMock.mockReturnValue(new Promise((resolve) => {
      releaseInvite = resolve;
    }));

    const first = useGroupStore.getState().inviteMembers('conversation-1', ['ptid:bob']);
    await expect(
      useGroupStore.getState().inviteMembers('conversation-1', ['ptid:bob']),
    ).resolves.toBeUndefined();
    expect(inviteMembersMock).toHaveBeenCalledOnce();

    releaseInvite({
      ok: true,
      data: { commands: [{ commandId: 'membership-command', state: 'pending' }] },
    });
    await first;

    expect(useGroupStore.getState().membershipOperations['conversation-1\u0000ptid:bob'])
      .toMatchObject({
        action: 'add',
        commandId: 'membership-command',
        phase: 'pending',
      });

    listMembersMock.mockResolvedValueOnce({
      ok: true,
      data: {
        members: [{ groupUlid: 'conversation-1', ptid: 'ptid:bob' }],
        total: 1,
      },
    });
    await useGroupStore.getState().loadMembers('conversation-1');

    expect(useGroupStore.getState().membershipOperations).toEqual({});
  });

  it('keeps failed remove state visible and allows an explicitly retried command', async () => {
    removeMemberMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'GROUP_MEMBERSHIP_COMMAND_FAILED',
        message: 'mobile.group.operationRemoveFailed',
        method: 'INVOKE',
        path: 'messaging_membership_transition',
      },
    });

    await expect(
      useGroupStore.getState().removeMember('conversation-1', 'ptid:bob'),
    ).rejects.toThrow('mobile.group.operationRemoveFailed');
    expect(useGroupStore.getState().membershipOperations['conversation-1\u0000ptid:bob'])
      .toMatchObject({ action: 'remove', phase: 'failed' });

    removeMemberMock.mockResolvedValueOnce({
      ok: true,
      data: { commands: [{ commandId: 'remove-retry', state: 'pending' }] },
    });
    listMembersMock.mockResolvedValueOnce({
      ok: true,
      data: {
        members: [{ groupUlid: 'conversation-1', ptid: 'ptid:bob' }],
        total: 1,
      },
    });
    await useGroupStore.getState().removeMember('conversation-1', 'ptid:bob');

    expect(removeMemberMock).toHaveBeenCalledTimes(2);
    expect(useGroupStore.getState().membershipOperations['conversation-1\u0000ptid:bob'])
      .toMatchObject({
        action: 'remove',
        commandId: 'remove-retry',
        phase: 'pending',
      });
  });

  it('projects asynchronous command rejection as failed without removing a member locally', async () => {
    removeMemberMock.mockResolvedValue({
      ok: true,
      data: { commands: [{ commandId: 'remove-command', state: 'pending' }] },
    });
    listMembersMock.mockResolvedValue({
      ok: true,
      data: {
        members: [{ groupUlid: 'conversation-1', ptid: 'ptid:bob' }],
        total: 1,
      },
    });
    commandStatusMock.mockResolvedValue({
      commandId: 'remove-command',
      conversationId: 'conversation-1',
      state: 'failed',
      lastErrorCode: 'authority_rejected',
    });

    await useGroupStore.getState().removeMember('conversation-1', 'ptid:bob');

    expect(useGroupStore.getState().members['conversation-1']).toHaveLength(1);
    expect(useGroupStore.getState().membershipOperations['conversation-1\u0000ptid:bob'])
      .toMatchObject({ action: 'remove', phase: 'failed' });
  });
});
