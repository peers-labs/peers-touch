import type { CSSProperties } from 'react';
import { SquareAvatar } from './SquareAvatar';
import { GroupCompositeAvatar, type GroupAvatarSlot } from './GroupCompositeAvatar';

/** Owner-key namespace for group conversation avatars. PTIDs use the
 * `ptid:` scheme, so group keys can never inherit an actor's pixels. */
const GROUP_AVATAR_OWNER_PREFIX = 'group-avatar:';

function groupAvatarOwnerKey(conversationId: string): string {
  return `${GROUP_AVATAR_OWNER_PREFIX}${conversationId.trim()}`;
}

interface GroupSquareAvatarProps {
  /** Conversation id; namespaces the locally held group avatar. */
  conversationId: string;
  remoteUrl?: string;
  name?: string;
  members: GroupAvatarSlot[];
  size?: number;
  radius?: number;
  border?: string;
  style?: CSSProperties;
}

export function GroupSquareAvatar({
  conversationId,
  remoteUrl,
  name = 'Group',
  members,
  size = 36,
  radius,
  border,
  style,
}: GroupSquareAvatarProps) {
  return (
    <SquareAvatar
      remoteUrl={remoteUrl}
      name={name}
      size={size}
      radius={radius}
      border={border}
      style={style}
      assetOwnerKey={groupAvatarOwnerKey(conversationId)}
    >
      <GroupCompositeAvatar members={members} size={size} />
    </SquareAvatar>
  );
}
