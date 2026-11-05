/**
 * ChatIdentity — wires a chat-surface avatar to the shared IdentityCard.
 *
 * Clicking a message avatar opens the same quick card as moments (identity +
 * latest moments), instead of being dead. Chat owns no follow/block state;
 * the card offers 发消息 (in-thread, closes) and 查看主页 / moment tiles,
 * which cross to the moments surface via the supplied navigation callbacks.
 */
import type { ReactElement } from 'react';
import { IdentityTrigger } from '../identity/IdentityCard';
import { identityTone } from '../identity-tone';
import { momentsByIdentity } from '../moments/AuthorCard';
import { PEOPLE_SEEDS, VIEWER } from '../moments/moments-data';
import type { Conversation } from './chat-data';

export function ChatAvatarTrigger({ name, tone, conversation, children,
  onOpenMomentsProfile, onOpenMoment }: {
  name: string;
  tone?: string;
  conversation: Conversation;
  children: ReactElement;
  onOpenMomentsProfile?: (name: string) => void;
  onOpenMoment?: (momentId: string) => void;
}) {
  const isSelf = name === VIEWER.name;
  const person = PEOPLE_SEEDS.find(p => p.name === name);
  const member = conversation.members?.find(m => m.name === name);
  return (
    <IdentityTrigger placement="bottom"
      name={name}
      tone={tone ?? member?.tone ?? person?.tone ?? (isSelf ? VIEWER.tone : identityTone(name))}
      station={person?.station ?? (conversation.kind === 'group' ? conversation.name : undefined)}
      bio={person?.bio}
      followers={person ? person.followers : undefined}
      mutual={person?.mutual}
      isSelf={isSelf}
      moments={momentsByIdentity(name)}
      onOpenProfile={isSelf || onOpenMomentsProfile
        ? () => onOpenMomentsProfile?.(name)
        : undefined}
      onMessage={() => { /* already in this thread; card closes itself */ }}
      onOpenMoment={onOpenMoment}>
      {children}
    </IdentityTrigger>
  );
}
