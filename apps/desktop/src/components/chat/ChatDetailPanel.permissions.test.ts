import { describe, expect, it } from 'vitest';

import { GroupRole } from '../../gen/proto/domain/chat/group_chat_pb';
import { getGroupMemberControlState } from './chatGroupPermissions';

describe('getGroupMemberControlState', () => {
  it('allows owners to manage admins and ordinary members', () => {
    expect(control(GroupRole.OWNER, GroupRole.ADMIN).canManageTarget).toBe(true);
    expect(control(GroupRole.OWNER, GroupRole.MEMBER).canManageTarget).toBe(true);
  });

  it('allows admins to manage ordinary members only', () => {
    expect(control(GroupRole.ADMIN, GroupRole.MEMBER).canManageTarget).toBe(true);
    expect(control(GroupRole.ADMIN, GroupRole.ADMIN)).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedAdmin',
    });
    expect(control(GroupRole.ADMIN, GroupRole.OWNER)).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedOwner',
    });
  });

  it('keeps members read-only', () => {
    expect(control(GroupRole.MEMBER, GroupRole.MEMBER, { canManageGroupMembers: false })).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedReadOnly',
    });
  });

  it('does not allow managing self', () => {
    expect(control(GroupRole.OWNER, GroupRole.OWNER, { isSelf: true })).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedSelf',
    });
  });
});

function control(
  myGroupRole: number,
  targetRole: number,
  overrides: Partial<Parameters<typeof getGroupMemberControlState>[0]> = {},
) {
  return getGroupMemberControlState({
    canManageGroupMembers: true,
    isSelf: false,
    membersLoaded: true,
    myGroupRole,
    targetRole,
    ...overrides,
  });
}
