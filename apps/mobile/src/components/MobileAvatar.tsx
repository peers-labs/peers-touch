import { useEffect, useState, type ReactNode } from 'react';
import { Avatar, type AvatarProps } from 'antd';

import { useAvatarAsset } from '../runtimes/avatarAssetRuntime';

type MobileAvatarProps = Omit<AvatarProps, 'src' | 'onError'> & {
  src?: string | null;
  children?: ReactNode;
};

export function MobileAvatar({ src, children, ...props }: MobileAvatarProps) {
  const avatar = useAvatarAsset(src);
  const [failedUrl, setFailedUrl] = useState<string>('');

  useEffect(() => {
    setFailedUrl('');
  }, [avatar.source]);

  const avatarSrc = avatar.src && failedUrl !== avatar.source ? avatar.src : undefined;
  return (
    <Avatar
      {...props}
      src={avatarSrc}
      onError={() => {
        if (avatar.source) setFailedUrl(avatar.source);
        return false;
      }}
    >
      {children}
    </Avatar>
  );
}
