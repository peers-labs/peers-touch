import { GroupAvatar } from '@peers-touch/ui';

/** Prototype member records adapt to the shared identity renderer. */
export interface GroupMemberTile {
  name: string;
  tone: string;
}

export function GroupAvatarComposite({ members, size = 40, radius, label, className = '', imageUrl }: {
  members: readonly GroupMemberTile[];
  size?: number;
  radius?: number;
  label: string;
  className?: string;
  /** Owner-uploaded group avatar; replaces the member composite when set (desktop avatarObjectId). */
  imageUrl?: string;
}) {
  return <GroupAvatar name={label} size={size} radius={radius}
    imageUrl={imageUrl} className={`sk-group-avatar${imageUrl ? ' sk-group-avatar-image' : ''} ${className}`}
    members={members.map((member, index) => ({ ...member, id: `${member.name}-${index}` }))} />;
}
