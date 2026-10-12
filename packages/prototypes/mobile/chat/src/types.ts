/**
 * Types, interfaces, and constants for the Mobile Prototype.
 */

// ── Types ──────────────────────────────────────────────────────
export type LaunchState = 'station-selection' | 'access-gate-chain' | 'shell';
export type TabId = 'chat' | 'moments' | 'contacts' | 'profile';
export type MessageStatus = 'sent' | 'delivered' | 'read';

export interface StationEntry {
  url: string;
  label: string;
  online: boolean | undefined;
}

export interface Conversation {
  key: string;
  name: string;
  avatar: string;
  avatarGradient: string;
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

export type ReactionKind = 'like' | 'love' | 'laugh' | 'wow' | 'celebrate';
export type MomentReactionKind = 'love';

export interface MessageReaction {
  kind: ReactionKind;
  emoji?: string;
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
  unknownOutcome?: boolean;
  pinned?: boolean;
  threadReplies?: Message[];
  threadCount?: number;
  flagged?: boolean;
}

export interface MomentComment {
  id: string;
  name: string;
  avatar: string;
  avatarGradient: string;
  text: string;
  time: string;
  replyTo?: string;
}

export interface Moment {
  id: string;
  name: string;
  avatar: string;
  avatarGradient: string;
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
  myReaction?: MomentReactionKind;
  reactionCounts?: Partial<Record<MomentReactionKind, number>>;
  comments: MomentComment[];
}

export interface Contact {
  key: string;
  name: string;
  avatar: string;
  avatarGradient: string;
  note: string;
  online?: boolean;
}

export interface GroupItem {
  key: string;
  name: string;
  avatar: string;
  avatarGradient: string;
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
  icon: React.ComponentType<{ size?: number }>;
  tint: string;
}

export interface SettingGroup {
  title: string;
  items: SettingEntry[];
}

// ── Gradient helpers ───────────────────────────────────────────
export const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
  'linear-gradient(135deg, #fccb90 0%, #d57eeb 100%)',
  'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)',
];

// ── Reaction emoji map ─────────────────────────────────────────
export const REACTION_EMOJI: Record<ReactionKind, string> = {
  like: '\u{1F44D}',
  love: '\u{2764}\u{FE0F}',
  laugh: '\u{1F604}',
  wow: '\u{1F62E}',
  celebrate: '\u{1F389}',
};

export const MOMENT_REACTION_EMOJI: Record<MomentReactionKind, string> = {
  love: '\u{2764}\u{FE0F}',
};
