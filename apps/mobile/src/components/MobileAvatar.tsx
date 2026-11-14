import { Avatar, type AvatarProps } from '@peers-touch/ui';

import { useAvatarAsset } from '../runtimes/avatarAssetRuntime';

type MobileAvatarProps = Omit<AvatarProps, 'source' | 'onImageFailure'> & {
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
  className,
  identityKey = '',
  name = '',
  size = 32,
  src,
  style,
  children,
  ...props
}: MobileAvatarProps) {
  const avatar = useAvatarAsset(src);
  const fallbackKey = identityKey.trim() || name.trim();

  return (
    <Avatar
      {...props}
      className={['mobile-user-avatar', className].filter(Boolean).join(' ')}
      size={size}
      source={avatar.source ?? undefined}
      name={name}
      background={
        fallbackKey && !style?.background
          ? mobileUserAvatarFallbackColor(fallbackKey)
          : undefined
      }
      style={style}
    >
      {children ?? avatarInitial(name)}
    </Avatar>
  );
}
