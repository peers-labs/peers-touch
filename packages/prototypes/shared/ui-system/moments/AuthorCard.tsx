/**
 * Moments adapter for the shared IdentityCard.
 *
 * Coverage rule: every identity chip outside the profile header opens the
 * quick card, including the viewer's own chips and actors without a seeded
 * Person (identity + profile entry only). The card also shows the actor's
 * latest moments. This file only maps moments data onto the surface-agnostic
 * card; the chrome/actions live in ../identity/IdentityCard.
 */
import type { ReactElement, ReactNode } from 'react';
import { IdentityCard, IdentityTrigger, type IdentityMoment } from '@peers-touch/ui';
import { identityCopy } from '../identity/identity-copy';
import type { Moment, Person } from './moments-data';
import { MOMENT_SEEDS, VIEWER } from './moments-data';

export function momentsByIdentity(name: string, posts: Moment[] = MOMENT_SEEDS): IdentityMoment[] {
  return posts
    .filter(post => post.author === name)
    .slice(0, 3)
    .map(post => ({ id: post.id, text: post.text, image: post.images?.[0], at: post.at }));
}

export function AuthorCard({ person, name, station, onOpenProfile, onToggleFollow, onToggleBlock }: {
  person?: Person;
  name: string;
  station?: string;
  onOpenProfile: () => void;
  onToggleFollow: () => void;
  onToggleBlock: () => void;
}) {
  const isSelf = name === VIEWER.name;
  return (
    <IdentityCard
      copy={identityCopy}
      name={name}
      tone={person?.tone ?? (isSelf ? VIEWER.tone : undefined)}
      station={person?.station ?? station}
      bio={person?.bio}
      followers={person ? person.followers : undefined}
      mutual={person?.mutual}
      isSelf={isSelf}
      resolved={Boolean(person)}
      followed={person?.followed ?? false}
      blocked={person?.blocked ?? false}
      moments={momentsByIdentity(name)}
      actionIdSuffix={person ? person.id : ''}
      onOpenProfile={onOpenProfile}
      onToggleFollow={person && !isSelf ? onToggleFollow : undefined}
      onToggleBlock={person && !isSelf ? onToggleBlock : undefined} />
  );
}

/**
 * Wraps a single semantic trigger (avatar or name button) with the quick
 * author card. The popover closes in the same gesture as profile navigation.
 */
export function AuthorTrigger({ name, person, station, children, placement = 'bottom',
  onOpenProfile, onToggleFollow, onToggleBlock, onOpenMoment }: {
  name: string;
  person?: Person;
  station?: string;
  children: ReactElement;
  placement?: 'bottom' | 'right' | 'top';
  onOpenProfile: (name: string) => void;
  onToggleFollow: (id: string) => void;
  onToggleBlock: (id: string) => void;
  /** Open one moment on the full moments surface (defaults to profile). */
  onOpenMoment?: (momentId: string) => void;
}): ReactNode {
  return (
    <IdentityTrigger placement={placement}
      copy={identityCopy}
      name={name}
      tone={person?.tone ?? (name === VIEWER.name ? VIEWER.tone : undefined)}
      station={person?.station ?? station}
      bio={person?.bio}
      followers={person ? person.followers : undefined}
      mutual={person?.mutual}
      isSelf={name === VIEWER.name}
      resolved={Boolean(person)}
      followed={person?.followed ?? false}
      blocked={person?.blocked ?? false}
      moments={momentsByIdentity(name)}
      actionIdSuffix={person ? person.id : ''}
      onOpenProfile={() => onOpenProfile(name)}
      onToggleFollow={person ? () => onToggleFollow(person.id) : undefined}
      onToggleBlock={person ? () => onToggleBlock(person.id) : undefined}
      onOpenMoment={onOpenMoment ?? (() => onOpenProfile(name))}>
      {children}
    </IdentityTrigger>
  );
}
