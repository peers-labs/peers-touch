import { Bot } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { SquareAvatar } from './SquareAvatar';

interface UserSquareAvatarProps {
  remoteUrl?: string;
  name?: string;
  size?: number;
  radius?: number;
  fallback?: ReactNode;
  background?: string;
  border?: string;
  style?: CSSProperties;
}

function nameInitial(name?: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 1).toUpperCase();
}

export function UserSquareAvatar({
  remoteUrl,
  name = 'User',
  size = 36,
  radius,
  fallback,
  background,
  border,
  style,
}: UserSquareAvatarProps) {
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  const initial = nameInitial(name);

  return (
    <SquareAvatar remoteUrl={remoteUrl} name={name} size={size} radius={radius} border={border} style={style}>
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
          color: '#fff',
          fontSize: Math.floor(size * 0.42),
          fontWeight: 700,
          lineHeight: 1,
          ...style,
        }}
      >
        {fallback || (initial ? initial : <Bot size={Math.floor(size * 0.5)} color="#fff" />)}
      </div>
    </SquareAvatar>
  );
}
