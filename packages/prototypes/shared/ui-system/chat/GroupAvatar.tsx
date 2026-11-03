/**
 * GroupAvatarComposite — the ONE group avatar rendering for every surface
 * (session list, profile hero, member pickers). Layout is derived from member
 * count: 2–4 members → 2×2, 5–9 → 3×3; tones come straight from the member
 * records (owner/admin already ordered upstream). No surface may repaint
 * tiles with its own background — list and profile must be identical.
 */
export interface GroupMemberTile {
  name: string;
  tone: string;
}

export function GroupAvatarComposite({ members, size = 40, label, className = '', imageUrl }: {
  members: readonly GroupMemberTile[];
  size?: number;
  label: string;
  className?: string;
  /** Owner-uploaded group avatar; replaces the member composite when set (desktop avatarObjectId). */
  imageUrl?: string;
}) {
  // Tiles fill their grid cells; glyph scales with the composite size.
  const fontSize = Math.max(9, Math.round(size * 0.3));
  if (imageUrl) {
    return (
      <span
        className={`sk-group-avatar sk-group-avatar-image ${className}`}
        data-columns={2}
        aria-label={label}
        style={{ width: size, height: size, fontSize }}
      >
        <img src={imageUrl} alt={label} />
      </span>
    );
  }
  const tiles = members.slice(0, 9);
  const columns = tiles.length > 4 ? 3 : 2;
  return (
    <span
      className={`sk-group-avatar ${className}`}
      data-columns={columns}
      aria-label={label}
      style={{ width: size, height: size, gridTemplateColumns: `repeat(${columns}, 1fr)`, fontSize: Math.max(9, Math.round(size * (columns === 3 ? 0.22 : 0.3))) }}
    >
      {tiles.map((m, i) => (
        <span key={`${m.name}-${i}`} className="sk-group-avatar-tile" style={{ background: m.tone }}>
          {m.name.slice(0, 1)}
        </span>
      ))}
    </span>
  );
}
