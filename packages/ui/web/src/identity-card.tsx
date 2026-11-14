/**
 * IdentityCard — the ONE quick identity popover used across surfaces.
 *
 * Clicking any identity avatar/name chip outside a profile header opens this
 * card instead of navigating away (WeChat parity): glance at who someone is,
 * see their latest moments, and act (message / follow / open full profile).
 * It is surface-agnostic — moments and chat adapt their own data into these
 * props; this module never imports a feature module's data.
 */
import './identity-card.css';
import { useState, type ReactElement, type ReactNode } from 'react';
import type { ActionExecution, Availability } from '@peers-touch/ui-contracts';
import { Avatar } from './data';
import { Button, Toggle } from './actions';
import { Popover } from './overlays';
import { Icon } from './icon';

/** Language and relationship truth are supplied by the consuming owner. */
export interface IdentityCardCopy {
  localStation: string;
  followers: string;
  mutual: string;
  recentMoments: string;
  follow: string;
  following: string;
  block: string;
  unblock: string;
  message: string;
  openProfile: string;
  openSelfProfile: string;
  cardLabel: (name: string) => string;
  momentLabel: (name: string, text: string) => string;
}

export interface FollowButtonProps {
  actionId: string;
  following: boolean;
  label: string;
  compact?: boolean;
  availability?: Availability;
  execution?: ActionExecution;
  onActivate: () => void;
}

export function FollowButton({ actionId, following, label, compact, availability,
  execution, onActivate }: FollowButtonProps) {
  return <Toggle actionId={actionId} className="sk-author-follow"
    emphasis={following ? 'secondary' : 'primary'} selected={following}
    availability={availability} execution={execution}
    data-author-follow={following ? 'on' : 'off'}
    leading={compact ? undefined : <Icon iconId={following ? 'check' : 'user-plus'} size={14} />}
    label={label} onSelectedChange={onActivate} />;
}

export interface IdentityMoment {
  id: string;
  text: string;
  /** First image of the post; when absent the tile shows a text snippet. */
  image?: string;
  at?: string;
}

export interface IdentityCardProps {
  copy: IdentityCardCopy;
  name: string;
  tone?: string;
  /** A native-cached avatar can be supplied without moving cache ownership. */
  avatar?: ReactNode;
  station?: string;
  bio?: string;
  followers?: number;
  mutual?: boolean;
  isSelf?: boolean;
  /** Whether the owning directory has resolved this actor. */
  resolved?: boolean;
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
  followExecution?: ActionExecution;
  followAvailability?: Availability;
  blockExecution?: ActionExecution;
  blockAvailability?: Availability;
}

export function IdentityCard(props: IdentityCardProps) {
  const {
    copy, name, tone, avatar, station, bio, followers, mutual, isSelf = false, resolved = false,
    followed = false, blocked = false, moments = [],
    onOpenProfile, onToggleFollow, onToggleBlock, onMessage, onOpenMoment,
    actionIdSuffix = '', followExecution, followAvailability, blockExecution, blockAvailability,
  } = props;
  const recent = moments.slice(0, 3);
  // Only follow/block are per-person command ids (author.follow.<personId>);
  // navigation/message/moment ids stay stable and suffix-free.
  const personAid = (base: string) => `${base}${actionIdSuffix}`;
  return (
    <div className="sk-author-card" data-author-name={name}
      data-author-self={isSelf ? 'true' : 'false'}
      data-author-seeded={resolved ? 'true' : 'false'}>
      <header className="sk-author-head">
        {avatar ?? <Avatar name={name} background={tone} size={44} style={{ borderRadius: 12 }} />}
        <div className="sk-author-idcol">
          <strong>{name}</strong>
          <span className="sk-author-station">{station ?? copy.localStation}</span>
        </div>
      </header>
      {bio && <p className="sk-author-bio">{bio}</p>}
      {!isSelf && (followers !== undefined || mutual) && (
        <div className="sk-author-stats">
          {followers !== undefined && <span><strong>{followers}</strong> {copy.followers}</span>}
          {mutual && <span className="sk-author-mutual">{copy.mutual}</span>}
        </div>
      )}
      {recent.length > 0 && (
        <section className="sk-author-moments" data-author-moments={recent.length}>
          <span className="sk-author-moments-title">{copy.recentMoments}</span>
          <div className="sk-author-moment-strip">
            {recent.map(moment => (
              <Button key={moment.id} emphasis="quiet" density="compact"
                actionId={`author.moment.${moment.id}`}
                className="sk-author-moment-tile"
                data-author-moment={moment.id}
                aria-label={copy.momentLabel(name, moment.text.slice(0, 20))}
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
          <FollowButton actionId={personAid('author.follow.')} following={followed}
            execution={followExecution} availability={followAvailability}
            label={followed ? copy.following : copy.follow} onActivate={onToggleFollow} />
        )}
        {!isSelf && onMessage && (
          <Button actionId="author.message" emphasis="secondary"
            data-author-message="true"
            leading={<Icon iconId="message-square" size={14} />}
            label={copy.message} onActivate={onMessage} />
        )}
        {!isSelf && onToggleBlock && (
          <Button actionId={personAid('author.block.')} emphasis="quiet" tone="danger" density="compact"
            data-author-block={blocked ? 'on' : 'off'}
            availability={blockAvailability} execution={blockExecution}
            label={blocked ? copy.unblock : copy.block} onActivate={onToggleBlock} />
        )}
        {onOpenProfile && (
          <Button actionId="author.open-profile" emphasis="secondary" fullWidth
            data-author-open="profile"
            label={isSelf ? copy.openSelfProfile : copy.openProfile} onActivate={onOpenProfile} />
        )}
      </div>
    </div>
  );
}

/**
 * Wraps one semantic trigger (avatar or name) with the identity card. The
 * popover closes itself on in-card navigation so the gesture is one step.
 */
export function IdentityTrigger({ children, placement = 'bottom', onOpenChange, ...cardProps }:
  IdentityCardProps & { children: ReactElement; placement?: 'bottom' | 'right' | 'top';
    onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const changeOpen = (value: boolean) => { setOpen(value); onOpenChange?.(value); };
  const close = () => changeOpen(false);
  return (
    <Popover placement={placement} label={cardProps.copy.cardLabel(cardProps.name)} open={open} onOpenChange={changeOpen}
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
