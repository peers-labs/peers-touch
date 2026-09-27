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
  images?: string[];
  likes: number;
  liked?: boolean;
  myReaction?: ReactionKind;
  reactionCounts?: Partial<Record<ReactionKind, number>>;
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

export interface SettingEntry {
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

export const REACTION_EMOJI_EXTENDED: string[] = ['\u{1F44D}', '\u{1F602}', '\u{1F63A}', '\u{1F44C}', '\u{2705}', '\u{1F914}', '\u{2764}\u{FE0F}', '\u{1F389}'];

export const FULL_EMOJI_GRID = [
  '\u{1F44D}', '\u{1F602}', '\u{1F63A}', '\u{1F44C}', '\u{2705}', '\u{1F914}', '\u{2764}\u{FE0F}', '\u{1F389}',
  '\u{1F44F}', '\u{1F64F}', '\u{1F4AA}', '\u{1F91D}', '\u{1FAE1}', '\u{1F62E}', '\u{1F605}', '\u{1F972}',
  '\u{1F60D}', '\u{1F923}', '\u{1F60E}', '\u{1F929}', '\u{1F973}', '\u{1F624}', '\u{1F62D}', '\u{1FAE0}',
  '\u{1F525}', '\u{1F4AF}', '\u{2B50}', '\u{1F31F}', '\u{2728}', '\u{1F4AB}', '\u{1F38A}', '\u{1F3AF}',
  '\u{1F440}', '\u{1F64C}', '\u{1F4AA}', '\u{1F919}', '\u{270C}\u{FE0F}', '\u{1FAF6}', '\u{1F49B}', '\u{1F49A}',
];
