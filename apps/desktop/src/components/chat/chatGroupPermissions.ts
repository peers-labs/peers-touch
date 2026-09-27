import { GroupRole } from '../../gen/proto/domain/chat/group_chat_pb';

export interface GroupMemberControlStateInput {
  canManageGroupMembers: boolean;
  isSelf: boolean;
  membersLoaded: boolean;
  myGroupRole: number;
  targetRole: number;
}

export function getGroupMemberControlState(input: GroupMemberControlStateInput): {
  canManageTarget: boolean;
  lockedReasonKey?: string;
} {
  const canManageTarget = input.canManageGroupMembers
    && input.membersLoaded
    && !input.isSelf
    && input.targetRole !== GroupRole.OWNER
    && (input.myGroupRole === GroupRole.OWNER || input.targetRole < input.myGroupRole);

  if (canManageTarget) return { canManageTarget };
  if (!input.canManageGroupMembers) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedReadOnly' };
  }
  if (input.isSelf) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedSelf' };
  }
  if (input.targetRole === GroupRole.OWNER) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedOwner' };
  }
  if (input.myGroupRole !== GroupRole.OWNER && input.targetRole >= GroupRole.ADMIN) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedAdmin' };
  }
  return { canManageTarget };
}
