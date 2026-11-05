/**
 * AuthorCard — quick identity popover for any non-profile surface.
 *
 * Clicking an avatar/name on a post or comment opens THIS small card instead
 * of navigating away; the full profile is reached only via its "查看主页"
 * action. Keeps browsing in place — users never open a full profile just to
 * glance at who someone is.
 *
 * Coverage rule: every identity chip outside the profile header opens this
 * card, including the viewer's own chips (self card offers "查看我的主页"
 * only) and actors without a seeded Person (identity + profile entry only).
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Check, UserPlus } from 'lucide-react';
import { Avatar, Button, Popover, Toggle } from '@peers-touch/ui';
import type { Person } from './moments-data';
import { VIEWER } from './moments-data';

export function AuthorCard({ person, name, station, onOpenProfile, onToggleFollow, onToggleBlock }: {
  person?: Person;
  name: string;
  /** Station fallback for post/comment actors that have no seeded Person. */
  station?: string;
  onOpenProfile: () => void;
  onToggleFollow: () => void;
  onToggleBlock: () => void;
}) {
  const isSelf = name === VIEWER.name;
  const tone = person?.tone ?? (isSelf ? VIEWER.tone : undefined);
  const followed = person?.followed ?? false;
  const blocked = person?.blocked ?? false;
  return (
    <div className="sk-author-card" data-author-name={name}
      data-author-self={isSelf ? 'true' : 'false'}
      data-author-seeded={person ? 'true' : 'false'}>
      <header className="sk-author-head">
        <Avatar name={name} background={tone} size={44} style={{ borderRadius: 12 }} />
        <div className="sk-author-idcol">
          <strong>{name}</strong>
          <span className="sk-author-station">{person?.station ?? station ?? '本站'}</span>
        </div>
      </header>
      {person?.bio && <p className="sk-author-bio">{person.bio}</p>}
      {person && !isSelf && (
        <div className="sk-author-stats">
          <span><strong>{person.followers}</strong> 粉丝</span>
          {person.mutual && <span className="sk-author-mutual">互相关注</span>}
        </div>
      )}
      <div className="sk-author-actions">
        {person && !isSelf && (
          <Toggle actionId={`author.follow.${person.id}`}
            className="sk-author-follow"
            emphasis={followed ? 'secondary' : 'primary'}
            selected={followed}
            data-author-follow={followed ? 'on' : 'off'}
            leading={followed ? <Check size={14} /> : <UserPlus size={14} />}
            label={followed ? '已关注' : '关注'}
            onSelectedChange={onToggleFollow} />
        )}
        {person && !isSelf && (
          <Button actionId={`author.block.${person.id}`} emphasis="quiet" tone="danger" density="compact"
            data-author-block={blocked ? 'on' : 'off'}
            label={blocked ? '取消拉黑' : '拉黑'} onActivate={onToggleBlock} />
        )}
        <Button actionId="author.open-profile" emphasis="secondary" fullWidth
          data-author-open="profile"
          label={isSelf ? '查看我的主页' : '查看主页'} onActivate={onOpenProfile} />
      </div>
    </div>
  );
}

/**
 * Wraps a single semantic trigger (avatar or name button) with the quick
 * author card. The popover is controlled here so that choosing "查看主页"
 * closes the card in the same gesture as the navigation.
 */
export function AuthorTrigger({ name, person, station, children, placement = 'bottom',
  onOpenProfile, onToggleFollow, onToggleBlock }: {
  name: string;
  person?: Person;
  station?: string;
  children: ReactElement;
  placement?: 'bottom' | 'right' | 'top';
  onOpenProfile: (name: string) => void;
  onToggleFollow: (id: string) => void;
  onToggleBlock: (id: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Popover placement={placement} label={`${name} 的名片`} open={open} onOpenChange={setOpen}
      className="sk-author-popover"
      content={
        <AuthorCard person={person} name={name} station={station}
          onOpenProfile={() => { setOpen(false); onOpenProfile(name); }}
          onToggleFollow={() => person && onToggleFollow(person.id)}
          onToggleBlock={() => person && onToggleBlock(person.id)} />
      }>
      {children}
    </Popover>
  );
}
