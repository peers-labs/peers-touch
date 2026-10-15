import { Avatar } from 'antd';
import type { CSSProperties } from 'react';

interface UserSquareAvatarStyle extends CSSProperties {
  '--mp-user-avatar-radius': string;
}

interface UserSquareAvatarProps {
  readonly background?: string;
  readonly name: string;
  readonly size?: number;
  readonly src?: string;
}

function avatarInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase();
}

export function UserSquareAvatar({
  background,
  name,
  size = 36,
  src,
}: UserSquareAvatarProps) {
  const style: UserSquareAvatarStyle = {
    '--mp-user-avatar-radius': `${Math.max(8, Math.floor(size * 0.25))}px`,
    background,
  };

  return (
    <Avatar
      className="mp-user-square-avatar"
      shape="square"
      size={size}
      src={src}
      style={style}
    >
      {avatarInitial(name)}
    </Avatar>
  );
}
