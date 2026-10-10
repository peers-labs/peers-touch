import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Avatar, type AvatarProps } from 'antd';

import { useAvatarAsset } from '../runtimes/avatarAssetRuntime';

interface MobileAvatarStyle extends CSSProperties {
  '--mobile-user-avatar-radius': string;
}

type MobileAvatarProps = Omit<
  AvatarProps,
  'children' | 'onError' | 'shape' | 'src'
> & {
  children?: ReactNode;
  identityKey?: string;
  name?: string;
  src?: string | null;
};

const MOBILE_AVATAR_COLORS = [
  '#4ecdc4',
  '#6c63ce',
  '#36bffa',
  '#e66fb1',
  '#7a8ce0',
  '#47c98b',
] as const;

export function mobileUserAvatarRadius(size: AvatarProps['size']): number {
  return typeof size === 'number' ? Math.max(8, Math.floor(size * 0.25)) : 8;
}

export function mobileUserAvatarFallbackColor(identityKey: string): string {
  let hash = 0;
  for (const character of identityKey.trim()) {
    hash = ((hash << 5) - hash + character.codePointAt(0)!) | 0;
  }
  return MOBILE_AVATAR_COLORS[Math.abs(hash) % MOBILE_AVATAR_COLORS.length];
}

function avatarInitial(name: string): string {
  return name.trim().slice(0, 1).toUpperCase();
}

export function MobileAvatar({
  children,
  className,
  identityKey = '',
  name = '',
  size = 32,
  src,
  style,
  ...props
}: MobileAvatarProps) {
  const avatar = useAvatarAsset(src);
  const [failedUrl, setFailedUrl] = useState<string>('');

  useEffect(() => {
    setFailedUrl('');
  }, [avatar.source]);

  const avatarSrc =
    avatar.src && failedUrl !== avatar.source ? avatar.src : undefined;
  const fallbackKey = identityKey.trim() || name.trim();
  const avatarStyle: MobileAvatarStyle = {
    '--mobile-user-avatar-radius': `${mobileUserAvatarRadius(size)}px`,
    ...(fallbackKey && !style?.background
      ? { background: mobileUserAvatarFallbackColor(fallbackKey) }
      : {}),
    ...style,
  };

  return (
    <Avatar
      {...props}
      className={['mobile-user-avatar', className].filter(Boolean).join(' ')}
      shape="square"
      size={size}
      src={avatarSrc}
      style={avatarStyle}
      onError={() => {
        if (avatar.source) setFailedUrl(avatar.source);
        return false;
      }}
    >
      {children ?? avatarInitial(name)}
    </Avatar>
  );
}
