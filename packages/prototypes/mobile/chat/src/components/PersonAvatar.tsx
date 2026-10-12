import { Avatar } from 'antd';
import type { CSSProperties } from 'react';

interface PersonAvatarStyle extends CSSProperties {
  '--mp-person-avatar-radius': string;
}

interface PersonAvatarProps {
  readonly background?: string;
  readonly name: string;
  readonly size?: number;
  readonly src?: string;
}

function avatarInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase();
}

export function PersonAvatar({
  background,
  name,
  size = 36,
  src,
}: PersonAvatarProps) {
  const style: PersonAvatarStyle = {
    '--mp-person-avatar-radius': `${Math.ceil(size / 2)}px`,
    background,
  };

  return (
    <Avatar
      className="mp-person-avatar mp-social-person-avatar"
      shape="circle"
      size={size}
      src={src}
      style={style}
    >
      {avatarInitial(name)}
    </Avatar>
  );
}
