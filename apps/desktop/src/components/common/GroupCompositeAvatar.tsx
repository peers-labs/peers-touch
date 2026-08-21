import { theme } from 'antd';
import { Users } from 'lucide-react';
import { UserSquareAvatar } from './UserSquareAvatar';

export interface GroupAvatarSlot {
  ptid?: string;
  name: string;
  avatar: string;
}

interface GroupCompositeAvatarProps {
  members: GroupAvatarSlot[];
  size?: number;
  gap?: number;
}

export function GroupCompositeAvatar({ members, size = 36, gap = 1 }: GroupCompositeAvatarProps) {
  const { token } = theme.useToken();
  const slots = members.slice(0, 4);
  const count = slots.length;
  const cellSize = count <= 1 ? size : Math.floor((size - gap) / 2);

  if (count === 0) {
    return (
      <div style={{
        width: size, height: size, borderRadius: Math.round(size * 0.25),
        background: token.colorFillSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: token.colorTextSecondary, flexShrink: 0,
      }}>
        <Users size={Math.round(size * 0.44)} />
      </div>
    );
  }

  const positions: { top: number; left: number }[] = (() => {
    if (count === 1) return [{ top: 0, left: 0 }];
    if (count === 2) return [
      { top: Math.floor((size - cellSize) / 2), left: 0 },
      { top: Math.floor((size - cellSize) / 2), left: cellSize + gap },
    ];
    if (count === 3) return [
      { top: 0, left: Math.floor((size - cellSize) / 2) },
      { top: cellSize + gap, left: 0 },
      { top: cellSize + gap, left: cellSize + gap },
    ];
    return [
      { top: 0, left: 0 },
      { top: 0, left: cellSize + gap },
      { top: cellSize + gap, left: 0 },
      { top: cellSize + gap, left: cellSize + gap },
    ];
  })();

  return (
    <div style={{ width: size, height: size, position: 'relative', flexShrink: 0, borderRadius: Math.round(size * 0.25), overflow: 'hidden' }}>
      {slots.map((member, i) => (
        <div
          key={i}
          data-chat-group-avatar-slot={member.ptid || ''}
          data-chat-avatar-ptid={member.ptid || ''}
          data-chat-avatar-src={member.avatar}
          style={{
            position: 'absolute',
            top: positions[i].top,
            left: positions[i].left,
            width: count === 1 ? size : cellSize,
            height: count === 1 ? size : cellSize,
          }}
        >
          <UserSquareAvatar
            remoteUrl={member.avatar}
            name={member.name}
            size={count === 1 ? size : cellSize}
            radius={count === 1 ? Math.round(size * 0.25) : Math.round(cellSize * 0.22)}
          />
        </div>
      ))}
    </div>
  );
}
