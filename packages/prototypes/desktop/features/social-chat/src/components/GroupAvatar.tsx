import { T } from '../theme';

/**
 * GroupAvatar — WeChat-style composite group picture.
 *
 * Renders up to the top 9 members as a tiled grid inside one rounded tile. The
 * cell layout adapts to the member count (1 centered, 2 columns, up to 3×3),
 * so the picture reflects the real roster instead of a single colored block.
 * The caller supplies resolved member tiles; the avatar never owns member data.
 */
export interface GroupAvatarTile {
  key: string;
  name: string;
  /** Optional real image. Tiles without one render colored initials. */
  src?: string;
}

interface GroupAvatarProps {
  members: GroupAvatarTile[];
  size?: number;
}

function hashColor(seed: string): string {
  const colors = ['#6b5bd6', '#38a169', '#d69e2e', '#e53e3e', '#3182ce', '#805ad5', '#d53f8c', '#319795'];
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

// Column count per tile number: 1→1, 2..4→2, 5..9→3.
function columnsFor(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

export function GroupAvatar({ members, size = 44 }: GroupAvatarProps) {
  const tiles = members.slice(0, 9);
  const cols = columnsFor(tiles.length);
  const radius = T.radiusLg;
  // Slight inner gap; the tile clips so corners stay crisp (no ragged edges).
  const gap = size >= 56 ? 2 : 1.5;
  const cell = (size - gap * (cols + 1)) / cols;
  const fontSize = Math.max(8, cell * 0.36);

  return (
    <div
      data-group-avatar={tiles.length}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        background: T.bgMuted,
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gap,
        padding: gap,
        boxSizing: 'border-box',
        flexShrink: 0,
      }}
    >
      {tiles.map((tile) => (
        <div
          key={tile.key}
          title={tile.name}
          style={{
            borderRadius: Math.max(2, cell * 0.18),
            overflow: 'hidden',
            background: tile.src ? T.bg : hashColor(tile.key || tile.name),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: T.textOnPrimary,
            fontSize,
            fontWeight: 600,
            lineHeight: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {tile.src
            ? (
              <img
                src={tile.src}
                alt={tile.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            )
            : initials(tile.name)}
        </div>
      ))}
    </div>
  );
}
