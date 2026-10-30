import { Bot } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactNode } from 'react';
import { SquareAvatar } from './SquareAvatar';

interface UserSquareAvatarProps {
  remoteUrl?: string;
  name?: string;
  size?: number;
  radius?: number;
  fallback?: ReactNode;
  /**
   * Neutral placeholder while the canonical avatar is resolving. Defaults to
   * the identity-neutral Bot glyph: an unresolved actor must never paint a
   * letter that could belong to a different actor (r3.1 edge matrix).
   */
  neutralFallback?: ReactNode;
  background?: string;
  border?: string;
  style?: CSSProperties;
  avatarLocalPath?: string | null;
  profileRevision?: number | string | null;
  actorPtid?: string | null;
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
  neutralFallback,
  background,
  border,
  style,
  avatarLocalPath,
  profileRevision,
  actorPtid,
}: UserSquareAvatarProps) {
  const rounded = radius ?? Math.max(8, Math.floor(size * 0.25));
  const initial = nameInitial(name);
  const { t } = useTranslation('common');

  const tileStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: rounded,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    border,
    ...style,
  };

  const absentFallback = fallback ?? (
    <div
      style={{
        ...tileStyle,
        background: background || 'linear-gradient(135deg, #667eea, #764ba2)',
        color: '#fff',
        fontSize: Math.floor(size * 0.42),
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {initial ? initial : <Bot size={Math.floor(size * 0.5)} color="#fff" />}
    </div>
  );

  const neutral = neutralFallback ?? (
    <div
      aria-hidden="true"
      style={{
        ...tileStyle,
        background: 'var(--color-fill-quaternary, rgba(127, 127, 127, 0.16))',
        color: 'var(--color-text-tertiary, rgba(127, 127, 127, 0.6))',
      }}
    >
      <Bot size={Math.floor(size * 0.5)} color="currentColor" />
    </div>
  );

  return (
    <SquareAvatar
      remoteUrl={remoteUrl}
      name={name}
      size={size}
      radius={radius}
      border={border}
      style={style}
      neutralFallback={neutral}
      avatarLocalPath={avatarLocalPath}
      profileRevision={profileRevision}
      actorPtid={actorPtid}
      degradedLabel={t('common.avatar.degraded')}
    >
      {absentFallback}
    </SquareAvatar>
  );
}
