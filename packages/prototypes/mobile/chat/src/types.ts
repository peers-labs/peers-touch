/**
 * Types, interfaces, and constants for the Mobile Prototype.
 */
import type { Icon } from '@peers-touch/ui';
import {
  QUICK_REACTION_KINDS, REACTION_CATALOG, REACTION_LABELS, emojiForKind, kindForEmoji,
} from '../../../shared/chat-domain';

export { QUICK_REACTION_KINDS, REACTION_CATALOG, REACTION_LABELS, kindForEmoji };
export type { ReactionKind } from '../../../shared/chat-domain';
import type { ReactionKind as DomainReactionKind } from '../../../shared/chat-domain';

type ReactionKind = DomainReactionKind;

export type IconName = Parameters<typeof Icon>[0]['iconId'];

// ── Types ──────────────────────────────────────────────────────
export type LaunchState = 'station-selection' | 'access-gate-chain' | 'shell';
export type TabId = 'chat' | 'moments' | 'contacts' | 'profile';
export type MessageStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'unknown';
export type AvatarRenderState = 'ready' | 'loading' | 'failed';
export type ChatListEvidenceState = 'ready' | 'initial-loading' | 'refreshing' | 'empty' | 'cached-error';
export type ChatThreadEvidenceState = 'ready' | 'initial-loading' | 'history-loading' | 'route-error' | 'unknown-outcome';

export interface MobileUiEvidence {
  avatarState: AvatarRenderState;
  chatListState: ChatListEvidenceState;
  chatThreadState: ChatThreadEvidenceState;
  longContent: boolean;
}

export interface StationEntry {
  url: string;
  label: string;
  online: boolean | undefined;
}

export interface Conversation {
  key: string;
  name: string;
  avatar: string;
  avatarUrl?: string;
  lastMessage: string;
  time: string;
  unread: number;
  online?: boolean;
  isGroup?: boolean;
  canModerate?: boolean;
  pinned?: boolean;
  muted?: boolean;
  lastSender?: string;
  memberCount?: number;
}

export interface MessageReply {
  name: string;
  text: string;
}

export interface MessageReaction {
  kind: ReactionKind;
  byMe: boolean;
  count: number;
}

export interface Message {
  id: string;
  text?: string;
  mine: boolean;
  time: string;
  status?: MessageStatus;
  reply?: MessageReply;
  image?: string;
  file?: { name: string; size: string };
  dateLabel?: string;
  reactions?: MessageReaction[];
  recalled?: boolean;
  moderated?: boolean;
  pinned?: boolean;
  threadReplies?: Message[];
  threadCount?: number;
  /** Local-only personal bookmark ("mark for later"); never leaves this device. */
  markedForLater?: boolean;
}

export interface MomentComment {
  id: string;
  name: string;
  avatar: string;
  avatarUrl?: string;
  text: string;
  time: string;
  replyTo?: string;
}

export interface Moment {
  id: string;
  name: string;
  avatar: string;
  avatarUrl?: string;
  time: string;
  text: string;
  source?: string;
  audience?: string;
  reason?: string;
  remote?: boolean;
  images?: string[];
  contentKind?: 'text' | 'image' | 'video' | 'link' | 'poll' | 'repost' | 'location';
  videoLabel?: string;
  link?: { title: string; url: string };
  poll?: { question: string; options: string[] };
  repost?: { author: string; text: string };
  location?: { name: string; address: string };
  likes: number;
  liked?: boolean;
  myReactions?: ReactionKind[];
  reactionCounts?: Partial<Record<ReactionKind, number>>;
  comments: MomentComment[];
}

export interface Contact {
  key: string;
  name: string;
  avatar: string;
  avatarUrl?: string;
  note: string;
  online?: boolean;
}

export interface GroupItem {
  key: string;
  name: string;
  avatar: string;
  memberCount: number;
}

export type SettingId =
  | 'account-info'
  | 'notifications'
  | 'privacy-security'
  | 'safety-number'
  | 'blocked-users'
  | 'chat-settings'
  | 'chat-background'
  | 'station-connection'
  | 'encryption'
  | 'language'
  | 'about';

export interface SettingEntry {
  id: SettingId;
  label: string;
  value?: string;
  iconId: IconName;
}

export interface SettingGroup {
  title: string;
  items: SettingEntry[];
}

// ── Reaction vocabulary ────────────────────────────────────────
// All reaction constants come from the headless shared chat domain; mobile
// only presents them in touch geometry. Kind list and emoji map are the
// single source of truth shared with desktop chat and moments.
export const REACTION_EMOJI: Record<ReactionKind, string> = Object.fromEntries(
  REACTION_CATALOG.map(meta => [meta.kind, emojiForKind(meta.kind)]),
) as Record<ReactionKind, string>;

/** Full kind list in catalog order (16). */
export const REACTION_KINDS: ReactionKind[] = REACTION_CATALOG.map(meta => meta.kind);

