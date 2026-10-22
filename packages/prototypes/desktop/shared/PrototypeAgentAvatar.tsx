import type { CSSProperties } from 'react';

export type PrototypeAgentAvatar =
  | { kind: 'initial' }
  | { kind: 'emoji'; value: string }
  | { kind: 'image'; value: string };

export const INITIAL_AGENT_AVATAR: PrototypeAgentAvatar = { kind: 'initial' };

export function normalizePrototypeAgentAvatar(value: unknown): PrototypeAgentAvatar {
  if (!value || typeof value !== 'object') return INITIAL_AGENT_AVATAR;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === 'emoji' && typeof candidate.value === 'string' && candidate.value) {
    return { kind: 'emoji', value: candidate.value };
  }
  if (
    candidate.kind === 'image'
    && typeof candidate.value === 'string'
    && candidate.value.startsWith('data:image/')
  ) {
    return { kind: 'image', value: candidate.value };
  }
  return INITIAL_AGENT_AVATAR;
}

export function PrototypeAgentAvatarView({
  avatar,
  name,
  size,
  radius = 9,
  selected = false,
  style,
}: {
  avatar: PrototypeAgentAvatar;
  name: string;
  size: number;
  radius?: number;
  selected?: boolean;
  style?: CSSProperties;
}) {
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: radius,
    flexShrink: 0,
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: selected ? '#6b5bd6' : '#ececf1',
    color: selected ? '#fff' : '#4f4f59',
    fontSize: Math.max(12, Math.round(size * 0.42)),
    fontWeight: 700,
    lineHeight: 1,
    ...style,
  };

  if (avatar.kind === 'image') {
    return (
      <span style={base} aria-hidden>
        <img
          src={avatar.value}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }

  return (
    <span style={base} aria-hidden>
      {avatar.kind === 'emoji' ? avatar.value : (name || 'A').charAt(0).toUpperCase()}
    </span>
  );
}
