import { GroupRole } from '../../gen/proto/domain/chat/group_chat_pb';

export interface MobileGroupMemberControlStateInput {
  canManageGroupMembers: boolean;
  isSelf: boolean;
  myGroupRole: number;
  targetRole: number;
}

export interface MobileGroupMemberControlState {
  canManageTarget: boolean;
  canPromoteOrDemote: boolean;
  canTransferOwnership: boolean;
  canMute: boolean;
  canRemove: boolean;
}

export function getMobileGroupMemberControlState(input: MobileGroupMemberControlStateInput): MobileGroupMemberControlState {
  const canManageTarget = input.canManageGroupMembers
    && !input.isSelf
    && input.targetRole !== GroupRole.OWNER
    && (input.myGroupRole === GroupRole.OWNER || input.targetRole < input.myGroupRole);

  return {
    canManageTarget,
    canPromoteOrDemote: canManageTarget && input.myGroupRole === GroupRole.OWNER,
    canTransferOwnership: canManageTarget && input.myGroupRole === GroupRole.OWNER,
    canMute: canManageTarget,
    canRemove: canManageTarget,
  };
}
