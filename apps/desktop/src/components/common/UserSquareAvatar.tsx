import { convertFileSrc } from '@tauri-apps/api/core';
import { Bot } from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';

interface UserSquareAvatarProps {
  /** Remote avatar URL (Station OSS or OAuth provider). */
  url?: string;
  /** Absolute local file path for cached avatar. Preferred over url when available. */
  localPath?: string;
  name?: string;
  size?: number;
  radius?: number;
  fallback?: ReactNode;
  background?: string;
  border?: string;
  style?: CSSProperties;
}

// Extract initial from a display name for the placeholder.
function nameInitial(name?: string): string {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 1).toUpperCase();
}

export function UserSquareAvatar({
  url,
  localPath,
  name = 'User',
  size = 36,
  radius,
  fallback,
  background,
  border,
  style,
}: UserSquareAvatarProps) {
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  const [imgError, setImgError] = useState(false);

  // Resolve the best available image source: local file first, remote URL fallback.
  const imgSrc = useMemo(() => {
    if (localPath) {
      try {
        return convertFileSrc(localPath);
      } catch {
        // convertFileSrc may fail in non-Tauri environments; fall through to remote URL.
      }
    }
    return url || '';
  }, [localPath, url]);

  const canShowImage = !!imgSrc && !imgError;

  if (canShowImage) {
    return (
      <img
        src={imgSrc}
        alt={name}
        onError={() => setImgError(true)}
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

  // Fallback: name initial or custom fallback or Bot icon.
  const initial = nameInitial(name);
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
        color: '#fff',
        fontSize: Math.floor(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
        ...style,
      }}
    >
      {fallback || (initial ? initial : <Bot size={Math.floor(size * 0.5)} color="#fff" />)}
    </div>
  );
}
