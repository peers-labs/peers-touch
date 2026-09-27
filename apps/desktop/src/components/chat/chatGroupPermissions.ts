import { MemberRole } from '../../gen/proto/domain/chat/conversation_pb';

export interface GroupMemberControlStateInput {
  canManageGroupMembers: boolean;
  isSelf: boolean;
  membersLoaded: boolean;
  myMemberRole: number;
  targetRole: number;
}

export function getGroupMemberControlState(input: GroupMemberControlStateInput): {
  canManageTarget: boolean;
  lockedReasonKey?: string;
} {
  const canManageTarget = input.canManageGroupMembers
    && input.membersLoaded
    && !input.isSelf
    && input.targetRole !== MemberRole.OWNER
    && (input.myMemberRole === MemberRole.OWNER || input.targetRole < input.myMemberRole);

  if (canManageTarget) return { canManageTarget };
  if (!input.canManageGroupMembers) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedReadOnly' };
  }
  if (input.isSelf) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedSelf' };
  }
  if (input.targetRole === MemberRole.OWNER) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedOwner' };
  }
  if (input.myMemberRole !== MemberRole.OWNER && input.targetRole >= MemberRole.ADMIN) {
    return { canManageTarget, lockedReasonKey: 'chat.social.detail.memberLockedAdmin' };
  }
  return { canManageTarget };
}
