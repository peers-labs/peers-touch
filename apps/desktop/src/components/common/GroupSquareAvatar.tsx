import type { CSSProperties } from 'react';
import { SquareAvatar } from './SquareAvatar';
import { GroupCompositeAvatar, type GroupAvatarSlot } from './GroupCompositeAvatar';

interface GroupSquareAvatarProps {
  remoteUrl?: string;
  name?: string;
  members: GroupAvatarSlot[];
  size?: number;
  radius?: number;
  border?: string;
  style?: CSSProperties;
}

export function GroupSquareAvatar({
  remoteUrl,
  name = 'Group',
  members,
  size = 36,
  radius,
  border,
  style,
}: GroupSquareAvatarProps) {
  return (
    <SquareAvatar remoteUrl={remoteUrl} name={name} size={size} radius={radius} border={border} style={style}>
      <GroupCompositeAvatar members={members} size={size} />
    </SquareAvatar>
  );
}
