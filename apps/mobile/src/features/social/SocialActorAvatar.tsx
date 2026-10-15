import type { AvatarProps } from 'antd';

import { MobileAvatar } from '../../components/MobileAvatar';
import {
  useSocialActorIdentity,
  type SocialActorIdentityFallback,
} from './useSocialActorIdentity';

type SocialActorAvatarProps = SocialActorIdentityFallback &
  Pick<AvatarProps, 'className' | 'size'>;

export function SocialActorAvatar({
  actorPtid,
  avatar,
  className,
  displayName,
  size,
  username,
}: SocialActorAvatarProps) {
  const identity = useSocialActorIdentity({
    actorPtid,
    avatar,
    displayName,
    username,
  });

  return (
    <MobileAvatar
      className={className}
      identityKey={identity.actorPtid}
      name={identity.displayName}
      size={size}
      src={identity.avatar}
    />
  );
}
