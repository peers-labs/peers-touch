import { Avatar, type AvatarProps } from '@peers-touch/ui';

import { useAvatarAsset } from '../runtimes/avatarAssetRuntime';

type MobileAvatarProps = Omit<AvatarProps, 'source' | 'onImageFailure'> & {
  identityKey?: string;
  name?: string;
  src?: string | null;
};
/**
 * Curated muted north-star identity hues, mirrored from the shared prototype
 * palette `packages/prototypes/shared/ui-system/identity-tone.ts` FALLBACK_TONES.
 * No green: brand pine (#2f6a50) is reserved for the self identity, so every
 * other person gets a stable medium-dark hue with a white glyph. Keep these in
 * sync with the prototype until the palette is promoted into packages/ui.
 */
const MOBILE_AVATAR_COLORS = [
  '#46588f', // slate indigo
  '#9f6a2c', // ochre
  '#a6513c', // terracotta
  '#2f7f8b', // teal
  '#7c5a40', // warm brown
  '#7451a0', // plum
  '#50708c', // steel blue
  '#3f6f9e', // indigo blue
  '#a2546e', // dusk rose
  '#5b62a8', // periwinkle
  '#2e8286', // cyan
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
