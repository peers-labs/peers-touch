import { describe, expect, it } from 'vitest';

import { MemberRole } from '../../gen/proto/domain/chat/conversation_pb';
import { getGroupMemberControlState } from './chatGroupPermissions';

describe('getGroupMemberControlState', () => {
  it('allows owners to manage admins and ordinary members', () => {
    expect(control(MemberRole.OWNER, MemberRole.ADMIN).canManageTarget).toBe(true);
    expect(control(MemberRole.OWNER, MemberRole.MEMBER).canManageTarget).toBe(true);
  });

  it('allows admins to manage ordinary members only', () => {
    expect(control(MemberRole.ADMIN, MemberRole.MEMBER).canManageTarget).toBe(true);
    expect(control(MemberRole.ADMIN, MemberRole.ADMIN)).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedAdmin',
    });
    expect(control(MemberRole.ADMIN, MemberRole.OWNER)).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedOwner',
    });
  });

  it('keeps members read-only', () => {
    expect(control(MemberRole.MEMBER, MemberRole.MEMBER, { canManageGroupMembers: false })).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedReadOnly',
    });
  });

  it('does not allow managing self', () => {
    expect(control(MemberRole.OWNER, MemberRole.OWNER, { isSelf: true })).toEqual({
      canManageTarget: false,
      lockedReasonKey: 'chat.social.detail.memberLockedSelf',
    });
  });
});

function control(
  myMemberRole: number,
  targetRole: number,
  overrides: Partial<Parameters<typeof getGroupMemberControlState>[0]> = {},
) {
  return getGroupMemberControlState({
    canManageGroupMembers: true,
    isSelf: false,
    membersLoaded: true,
    myMemberRole,
    targetRole,
    ...overrides,
  });
}
