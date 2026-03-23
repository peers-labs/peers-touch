import { theme } from 'antd';
import { Bot } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

interface UserSquareAvatarProps {
  url?: string;
  name?: string;
  size?: number;
  radius?: number;
  fallback?: ReactNode;
  background?: string;
  border?: string;
  style?: CSSProperties;
}

export function UserSquareAvatar({
  url,
  name = 'User',
  size = 36,
  radius,
  fallback,
  background,
  border,
  style,
}: UserSquareAvatarProps) {
  const { token } = theme.useToken();
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: rounded,
          objectFit: 'cover',
          flexShrink: 0,
          border,
          ...style,
        }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        background: background || 'linear-gradient(135deg, #667eea, #764ba2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        border,
        color: token.colorText,
        ...style,
      }}
    >
      {fallback || <Bot size={Math.floor(size * 0.5)} color="#fff" />}
    </div>
  );
}
