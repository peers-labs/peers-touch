/**
 * IdentityCard — prototype host adapter for @peers-touch/ui-composite.
 *
 * This file OWNS:
 *   - Prototype IdentityCardProps → IdentityProfileModel mapping
 *   - peers-ui Avatar construction (avatarSlot; native avatar never enters
 *     the composite, CMP-D06)
 *   - Relationship action row (follow/message/block/open-profile) as the
 *     host-owned actionsSlot, preserving every data-author-* gate hook
 *   - sk-author-* legacy class + data-author-* root attribute injection via
 *     SurfaceHooks (CMP-D03)
 *   - The IdentityTrigger popover shell (ui primitive; host orchestration)
 *
 * This file does NOT own:
 *   - Card DOM structure / three-variant grammar — IdentityProfileCard renders
 *     the ptc-* tree
 *   - Moments strip / technical details / pills rendering — composite owns
 *
 * All visible text flows through useT(); no natural-language literals.
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { Check, MessageSquare, UserPlus } from 'lucide-react';
import { Avatar, Button, Popover, Toggle } from '@peers-touch/ui';

import { IdentityProfileCard } from '@peers-touch/ui-composite';
import type {
  CompositeTranslate, IdentityProfileIntents, IdentityProfileModel,
  IdentityRegionKey, SurfaceHooks,
} from '@peers-touch/ui-composite';

import { useT } from '../prefs';
import './identity.css';

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
  const { t: protoT } = useT();
  // Adapter boundary: composite accepts string keys; prototype Translate
  // narrows to STRINGS literals. All identity.* keys are mirrored in STRINGS.
  const t = protoT as CompositeTranslate;
  const {
    name, tone, station, bio, followers, mutual, isSelf = false, seeded = false,
    followed = false, blocked = false, moments = [],
    onOpenProfile, onToggleFollow, onToggleBlock, onMessage, onOpenMoment,
    actionIdSuffix = '',
  } = props;

  // Only follow/block are per-person command ids (author.follow.<personId>);
  // navigation/message/moment ids stay stable and suffix-free.
  const personAid = (base: string) => `${base}${actionIdSuffix}`;

  const model: IdentityProfileModel = {
    displayName: name,
    isSelf,
    avatarSlot: <Avatar name={name} background={tone} size={44} style={{ borderRadius: 12 }} />,
    stationLines: [station ?? t('identity.station.local')],
    bio,
    relation: mutual ? { label: t('identity.relation.mutual'), tone: 'processing' } : undefined,
    stats: followers !== undefined && !isSelf
      ? [{ label: t('identity.stats.followers'), value: followers }]
      : undefined,
    moments,
  };

  const intents: IdentityProfileIntents = {
    onOpenMoment: onOpenMoment
      ? (momentId) => onOpenMoment(momentId)
      : undefined,
    onOpenProfile,
  };

  // Host-owned relationship actions — gate hooks stay on these exact nodes.
  const actionsSlot: ReactNode = (
    <div className="sk-author-actions">
      {!isSelf && onToggleFollow && (
        <Toggle actionId={personAid('author.follow.')}
          className="sk-author-follow"
          emphasis={followed ? 'secondary' : 'primary'}
          selected={followed}
          data-author-follow={followed ? 'on' : 'off'}
          leading={followed ? <Check size={14} /> : <UserPlus size={14} />}
          label={followed ? t('identity.action.following') : t('identity.action.follow')}
          onSelectedChange={onToggleFollow} />
      )}
      {!isSelf && onMessage && (
        <Button actionId="author.message" emphasis="secondary"
          data-author-message="true"
          leading={<MessageSquare size={14} />} label={t('identity.action.message')} onActivate={onMessage} />
      )}
      {!isSelf && onToggleBlock && (
        <Button actionId={personAid('author.block.')} emphasis="quiet" tone="danger" density="compact"
          data-author-block={blocked ? 'on' : 'off'}
          label={blocked ? t('identity.action.unblock') : t('identity.action.block')} onActivate={onToggleBlock} />
      )}
      {onOpenProfile && (
        <Button actionId="author.open-profile" emphasis="secondary" fullWidth
          data-author-open="profile"
          label={isSelf ? t('identity.action.openMyProfile') : t('identity.action.openProfile')}
          onActivate={onOpenProfile} />
      )}
    </div>
  );

  const hooks: SurfaceHooks<IdentityRegionKey> = {
    classNames: {
      card: 'sk-author-card',
      moments: 'sk-author-moments',
      momentTile: 'sk-author-moment-tile',
    },
    dataAttributes: {
      card: {
        'data-author-name': name,
        'data-author-self': isSelf ? 'true' : 'false',
        'data-author-seeded': seeded ? 'true' : 'false',
      },
    },
  };

  return (
    <IdentityProfileCard
      variant="author"
      profile={model}
      actionsSlot={actionsSlot}
      intents={intents}
      t={t}
      hooks={hooks}
    />
  );
}

/**
 * Wraps one semantic trigger (avatar or name) with the identity card. The
 * popover closes itself on in-card navigation so the gesture is one step.
 */
export function IdentityTrigger({ children, placement = 'bottom', ...cardProps }:
  IdentityCardProps & { children: ReactElement; placement?: 'bottom' | 'right' | 'top' }) {
  const { t: protoT } = useT();
  const t = protoT as CompositeTranslate;
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Popover placement={placement} label={t('identity.popover.cardLabel', { name: cardProps.name })} open={open} onOpenChange={setOpen}
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
