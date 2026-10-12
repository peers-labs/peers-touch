import { T } from '../theme';

interface AvatarProps {
  name: string;
  src?: string;
  size?: number;
  online?: boolean;
  groupIcon?: boolean;
  identityKey?: string;
  initials?: string;
  /**
   * Peer belongs to another station (federation). Carried as semantic metadata
   * (data attribute + hover title); the list avatar itself stays visually clean.
   * The human-facing cue lives on the contact/conversation detail surface, never
   * as a border around the avatar (which reads as selection/focus).
   */
  federated?: boolean;
}

function getInitials(name: string): string {
  const parts = name.split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function hashColor(name: string): string {
  const colors = ['#6b5bd6', '#38a169', '#d69e2e', '#e53e3e', '#3182ce', '#805ad5', '#d53f8c', '#319795'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export function Avatar({
  name,
  src,
  size = 40,
  online,
  groupIcon,
  identityKey,
  initials: initialsProp,
  federated = false,
}: AvatarProps) {
  const initials = initialsProp ?? getInitials(name);
  const bgColor = hashColor(identityKey || src || name);
  const fontSize = size * 0.38;
  const radius = groupIcon ? T.radiusLg : T.radiusMd;

  return (
    <div
      data-federated={federated ? 'true' : undefined}
      title={federated ? `${name} · from another network` : undefined}
      style={{
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
      }}
    >
      {src ? (
        <img
          src={src}
          alt={name}
          style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }}
        />
      ) : (
        <div
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            background: bgColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.textOnPrimary,
            fontSize,
            fontWeight: 600,
            letterSpacing: 0,
          }}
        >
          {initials}
        </div>
      )}
      {online !== undefined && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: size * 0.28,
            height: size * 0.28,
            borderRadius: T.radiusFull,
            background: online ? T.success : T.textQuaternary,
            border: `2px solid ${T.bg}`,
          }}
        />
      )}
    </div>
  );
}
