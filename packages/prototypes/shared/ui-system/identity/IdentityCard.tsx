/**
 * IdentityCard — the ONE quick identity popover used across surfaces.
 *
 * Clicking any identity avatar/name chip outside a profile header opens this
 * card instead of navigating away (WeChat parity): glance at who someone is,
 * see their latest moments, and act (message / follow / open full profile).
 * It is surface-agnostic — moments and chat adapt their own data into these
 * props; this module never imports a feature module's data.
 */
import './identity.css';
import { useState, type ReactElement } from 'react';
import { Check, MessageSquare, UserPlus } from 'lucide-react';
import { Avatar, Button, Popover, Toggle } from '@peers-touch/ui';

export interface IdentityMoment {
  id: string;
  text: string;
  /** First image of the post; when absent the tile shows a text snippet. */
  image?: string;
  at?: string;
}

export interface IdentityCardProps {
  name: string;
  tone?: string;
  station?: string;
  bio?: string;
  followers?: number;
  mutual?: boolean;
  isSelf?: boolean;
  /** Actor resolves to a seeded directory person vs. an unseeded identity. */
  seeded?: boolean;
  followed?: boolean;
  blocked?: boolean;
  /** Up to three latest moments, newest first. */
  moments?: IdentityMoment[];
  /** Open the full profile (moments surface). Hidden when unavailable. */
  onOpenProfile?: () => void;
  onToggleFollow?: () => void;
  onToggleBlock?: () => void;
  /** Already-in-thread action (chat surface): closes the card. */
  onMessage?: () => void;
  /** Open one moment on the moments surface. */
  onOpenMoment?: (momentId: string) => void;
  /** Suffixes action ids (e.g. person id → author.follow.<id>). */
  actionIdSuffix?: string;
}

export function IdentityCard(props: IdentityCardProps) {
  const {
    name, tone, station, bio, followers, mutual, isSelf = false, seeded = false,
    followed = false, blocked = false, moments = [],
    onOpenProfile, onToggleFollow, onToggleBlock, onMessage, onOpenMoment,
    actionIdSuffix = '',
  } = props;
  const recent = moments.slice(0, 3);
  // Only follow/block are per-person command ids (author.follow.<personId>);
  // navigation/message/moment ids stay stable and suffix-free.
  const personAid = (base: string) => `${base}${actionIdSuffix}`;
  return (
    <div className="sk-author-card" data-author-name={name}
      data-author-self={isSelf ? 'true' : 'false'}
      data-author-seeded={seeded ? 'true' : 'false'}>
      <header className="sk-author-head">
        <Avatar name={name} background={tone} size={44} style={{ borderRadius: 12 }} />
        <div className="sk-author-idcol">
          <strong>{name}</strong>
          <span className="sk-author-station">{station ?? '本站'}</span>
        </div>
      </header>
      {bio && <p className="sk-author-bio">{bio}</p>}
      {!isSelf && (followers !== undefined || mutual) && (
        <div className="sk-author-stats">
          {followers !== undefined && <span><strong>{followers}</strong> 粉丝</span>}
          {mutual && <span className="sk-author-mutual">互相关注</span>}
        </div>
      )}
      {recent.length > 0 && (
        <section className="sk-author-moments" data-author-moments={recent.length}>
          <span className="sk-author-moments-title">最近动态</span>
          <div className="sk-author-moment-strip">
            {recent.map(moment => (
              <Button key={moment.id} emphasis="quiet" density="compact"
                actionId={`author.moment.${moment.id}`}
                className="sk-author-moment-tile"
                data-author-moment={moment.id}
                aria-label={`${name} 的动态：${moment.text.slice(0, 20)}`}
                onActivate={() => onOpenMoment?.(moment.id)}>
                {moment.image
                  ? <span className="sk-author-moment-thumb" style={{ backgroundImage: `url("${moment.image}")` }} />
                  : <span className="sk-author-moment-text">{moment.text}</span>}
              </Button>
            ))}
          </div>
        </section>
      )}
      <div className="sk-author-actions">
        {!isSelf && onToggleFollow && (
          <Toggle actionId={personAid('author.follow.')}
            className="sk-author-follow"
            emphasis={followed ? 'secondary' : 'primary'}
            selected={followed}
            data-author-follow={followed ? 'on' : 'off'}
            leading={followed ? <Check size={14} /> : <UserPlus size={14} />}
            label={followed ? '已关注' : '关注'}
            onSelectedChange={onToggleFollow} />
        )}
        {!isSelf && onMessage && (
          <Button actionId="author.message" emphasis="secondary"
            data-author-message="true"
            leading={<MessageSquare size={14} />} label="发消息" onActivate={onMessage} />
        )}
        {!isSelf && onToggleBlock && (
          <Button actionId={personAid('author.block.')} emphasis="quiet" tone="danger" density="compact"
            data-author-block={blocked ? 'on' : 'off'}
            label={blocked ? '取消拉黑' : '拉黑'} onActivate={onToggleBlock} />
        )}
        {onOpenProfile && (
          <Button actionId="author.open-profile" emphasis="secondary" fullWidth
            data-author-open="profile"
            label={isSelf ? '查看我的主页' : '查看主页'} onActivate={onOpenProfile} />
        )}
      </div>
    </div>
  );
}

/**
 * Wraps one semantic trigger (avatar or name) with the identity card. The
 * popover closes itself on in-card navigation so the gesture is one step.
 */
export function IdentityTrigger({ children, placement = 'bottom', ...cardProps }:
  IdentityCardProps & { children: ReactElement; placement?: 'bottom' | 'right' | 'top' }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Popover placement={placement} label={`${cardProps.name} 的名片`} open={open} onOpenChange={setOpen}
      className="sk-author-popover"
      content={
        <IdentityCard {...cardProps}
          onOpenProfile={cardProps.onOpenProfile ? () => { close(); cardProps.onOpenProfile?.(); } : undefined}
          onMessage={cardProps.onMessage ? () => { close(); cardProps.onMessage?.(); } : undefined}
          onOpenMoment={cardProps.onOpenMoment
            ? (id) => { close(); cardProps.onOpenMoment?.(id); }
            : undefined} />
      }>
      {children}
    </Popover>
  );
}
