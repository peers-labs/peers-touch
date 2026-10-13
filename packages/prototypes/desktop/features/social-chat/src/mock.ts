/**
 * Mock data for the social chat prototype.
 * Represents realistic conversation and member states.
 */
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_MESSAGE_ID,
  resolveChatJourneyLocale,
} from '../../../../shared/chat-journey';

export const CHAT_JOURNEY_LOCALE = typeof window === 'undefined'
  ? 'en'
  : resolveChatJourneyLocale(window.location.search, window.navigator.language);

export interface MockUser {
  id: string;
  name: string;
  avatar: string;
  online: boolean;
  username?: string;
  federatedHandle?: string;
  homeStation?: string;
  homeStationPeerId?: string;
  federationId?: string;
  federationName?: string;
  /**
   * Home station differs from the local station (cross-station federation).
   * Every contact has a home station, so presence of `homeStation` is NOT the
   * signal; this explicit boolean drives the single trust deviation cue.
   */
  federated?: boolean;
}

export interface MockMessage {
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'image' | 'file' | 'voice' | 'system';
  replyTo?: string;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  attachmentName?: string;
  attachmentMeta?: string;
  attachmentUrl?: string;
  durationSeconds?: number;
  transferState?: 'ready' | 'failed';
  edited?: boolean;
}

export interface MockConversation {
  id: string;
  type: 'friend' | 'group';
  name: string;
  avatar: string;
  lastMessage: string;
  lastMessageTime: number;
  unread: number;
  muted: boolean;
  pinned: boolean;
  online?: boolean;
  memberCount?: number;
  trustLabel: string;
  trustTone: 'local' | 'remote' | 'verified' | 'attention';
  detailHint: string;
  myNickname?: string;
  background?: string;
  backgroundImage?: string;
  // Friend identity (mirrors real ChatDetailPanel PublicProfileCard)
  handle?: string;
  station?: string;
  peerPtid?: string;
  federationId?: string;
  // Peer's home station differs from the local station (federated/cross-station).
  // Explicit signal for the trust-state deviation cue; never inferred from strings.
  federated?: boolean;
  chatKindLabel?: string;
  stats?: { posts: number; followers: number; following: number };
}

export type MockGroupRole = 'owner' | 'admin' | 'member';

/**
 * Federation provenance carried when a friend session is opened from a contact
 * or search result. Addresses here are locators only; the UI surfaces the
 * boolean as a deviation cue and keeps the strings in the detail surface.
 */
export interface FederatedFriendMeta {
  federated?: boolean;
  station?: string;
  handle?: string;
}

export interface MockGroupMember {
  userId: string;
  role: MockGroupRole;
  muted: boolean;
  joinedAt: number;
}

export const CURRENT_USER: MockUser = {
  id: 'user-self',
  name: 'Alex Chen',
  avatar: '',
  online: true,
};

export const USERS: Record<string, MockUser> = {
  'user-self': CURRENT_USER,
  'user-1': { id: 'user-1', name: 'Sarah Kim', avatar: '', online: true },
  'user-2': { id: 'user-2', name: 'David Liu', avatar: '', online: false },
  'user-3': { id: 'user-3', name: 'Emma Wang', avatar: '', online: true },
  'user-4': { id: 'user-4', name: 'James Zhou', avatar: '', online: false },
  'user-5': { id: 'user-5', name: 'Lisa Park', avatar: '', online: true },
  'user-6': { id: 'user-6', name: 'Michael Xu', avatar: '', online: true },
  'user-7': { id: 'user-7', name: 'Nina Patel', avatar: '', online: false },
  'user-8': { id: 'user-8', name: 'Owen Reed', avatar: '', online: true },
  'bob-aspen': {
    id: 'ptid:bob:aspen',
    name: 'Bob',
    username: 'bob',
    avatar: '',
    online: true,
    federatedHandle: '@bob@aspen.social',
    homeStation: 'aspen.social',
    homeStationPeerId: '12D3KooW-aspen',
    federationId: 'fed-friends',
    federationName: 'Friends Federation',
    federated: true,
  },
  'bob-harbor': {
    id: 'ptid:bob:harbor',
    name: 'Bob',
    username: 'bob',
    avatar: '',
    online: false,
    federatedHandle: '@bob@harbor.social',
    homeStation: 'harbor.social',
    homeStationPeerId: '12D3KooW-harbor',
    federationId: 'fed-friends',
    federationName: 'Friends Federation',
    federated: true,
  },
};

export const CONTACTS = [
  USERS['bob-aspen'],
  USERS['bob-harbor'],
  {
    id: 'ptid:carol:aspen',
    name: 'Carol',
    username: 'carol',
    avatar: '',
    online: true,
    federatedHandle: '@carol@aspen.social',
    homeStation: 'aspen.social',
    homeStationPeerId: '12D3KooW-aspen',
    federationId: 'fed-friends',
    federationName: 'Friends Federation',
    federated: true,
  },
] satisfies MockUser[];

export const CONVERSATIONS: MockConversation[] = [
  {
    id: 'conv-1',
    type: 'group',
    name: CHAT_JOURNEY.conversationName[CHAT_JOURNEY_LOCALE],
    avatar: '',
    lastMessage: CHAT_JOURNEY.messages.outbound[CHAT_JOURNEY_LOCALE],
    lastMessageTime: Date.now() - 120_000,
    unread: 1,
    muted: false,
    pinned: true,
    memberCount: CHAT_JOURNEY.participants,
    trustLabel: 'Owner controls available',
    trustTone: 'verified',
    detailHint: `${CHAT_JOURNEY.station} · encrypted group`,
    myNickname: 'Alex',
    background: 'Calm blue',
  },
  {
    id: 'conv-2',
    type: 'friend',
    name: 'Sarah Kim',
    avatar: '',
    lastMessage: 'Sounds good, see you tomorrow!',
    lastMessageTime: Date.now() - 300_000,
    unread: 0,
    muted: false,
    pinned: true,
    online: true,
    trustLabel: 'Verified identity',
    trustTone: 'verified',
    detailHint: 'Private chat: identity verification and block controls are visible.',
    background: 'Default',
    handle: '@sarah',
    station: 'peers-touch-station',
    peerPtid: 'ptid:sarah-7c10',
    federationId: 'fed-friends',
    chatKindLabel: 'Standard chat',
    stats: { posts: 0, followers: 0, following: 0 },
  },
  {
    // Cross-station friend: the built-in federated contact Bob (USERS['bob-aspen'],
    // home station aspen.social) rendered as an open conversation, so the single
    // deviation cue is visible against same-station peers in the list.
    id: 'conv-7',
    type: 'friend',
    name: 'Bob',
    avatar: '',
    lastMessage: 'See you at the team call.',
    lastMessageTime: Date.now() - 200_000,
    unread: 1,
    muted: false,
    pinned: false,
    online: true,
    trustLabel: 'Verified identity',
    trustTone: 'verified',
    detailHint: 'Cross-station friend on aspen.social.',
    background: 'Default',
    handle: '@bob@aspen.social',
    station: 'aspen.social',
    peerPtid: 'ptid:bob:aspen',
    federationId: 'fed-friends',
    federated: true,
    chatKindLabel: 'Standard chat',
    stats: { posts: 4, followers: 11, following: 9 },
  },
  {
    id: 'conv-3',
    type: 'group',
    name: 'Design Review',
    avatar: '',
    lastMessage: 'Emma shared a file: mockup-v3.fig',
    lastMessageTime: Date.now() - 900_000,
    unread: 8,
    muted: true,
    pinned: false,
    memberCount: 4,
    trustLabel: 'Admin controls limited',
    trustTone: 'local',
    detailHint: 'Admin view: manage normal members, cannot transfer owner or manage admins.',
    myNickname: 'Alex C.',
    background: 'Paper',
  },
  {
    id: 'conv-4',
    type: 'friend',
    name: 'David Liu',
    avatar: '',
    lastMessage: 'Can you review my PR?',
    lastMessageTime: Date.now() - 3_600_000,
    unread: 1,
    muted: false,
    pinned: false,
    online: false,
    trustLabel: 'Not verified',
    trustTone: 'attention',
    detailHint: 'Private chat: prompt identity verification before trusting sensitive content.',
    background: 'Graphite',
    handle: '@david',
    station: 'peers-touch-station',
    peerPtid: 'ptid:david-33aa',
    chatKindLabel: 'Standard chat',
    stats: { posts: 12, followers: 4, following: 18 },
  },
  {
    id: 'conv-5',
    type: 'group',
    name: 'Peers Touch',
    avatar: '',
    lastMessage: 'James: Sprint planning moved to Friday',
    lastMessageTime: Date.now() - 7_200_000,
    unread: 0,
    muted: false,
    pinned: false,
    memberCount: 7,
    trustLabel: 'Member view only',
    trustTone: 'remote',
    detailHint: 'Member view: roster is readable, management actions stay locked.',
    myNickname: '',
    background: 'Mint',
  },
  {
    id: 'conv-6',
    type: 'friend',
    name: 'Lisa Park',
    avatar: '',
    lastMessage: 'Thanks for the help!',
    lastMessageTime: Date.now() - 86_400_000,
    unread: 0,
    muted: false,
    pinned: false,
    online: true,
    trustLabel: 'Encrypted',
    trustTone: 'local',
    detailHint: 'Private chat: lightweight details without protocol noise.',
    background: 'Default',
    handle: '@lisa',
    station: 'peers-touch-station',
    peerPtid: 'ptid:lisa-9b21',
    chatKindLabel: 'Standard chat',
    stats: { posts: 0, followers: 0, following: 0 },
  },
];

export const MESSAGES: Record<string, MockMessage[]> = {
  'conv-1': [
    { id: 'm1', senderId: 'user-3', content: CHAT_JOURNEY_LOCALE === 'zh' ? '我还在确认重连是否恢复。' : "I'm still verifying the reconnect.", timestamp: Date.now() - 540_000, type: 'text' },
    { id: 'm2', senderId: 'user-1', content: CHAT_JOURNEY.messages.inbound[CHAT_JOURNEY_LOCALE], timestamp: Date.now() - 360_000, type: 'text' },
    { id: CHAT_JOURNEY_MESSAGE_ID, senderId: 'user-self', content: CHAT_JOURNEY.messages.outbound[CHAT_JOURNEY_LOCALE], timestamp: Date.now() - 240_000, type: 'text', status: 'failed' },
    { id: 'm4', senderId: 'system', content: CHAT_JOURNEY_LOCALE === 'zh' ? '已保存在本机，等待发送。' : 'Saved on this device · waiting to send.', timestamp: Date.now() - 210_000, type: 'system' },
  ],
  'conv-2': [
    { id: 'f1', senderId: 'user-1', content: 'Hey, are you free for coffee tomorrow?', timestamp: Date.now() - 600_000, type: 'text' },
    { id: 'f2', senderId: 'user-self', content: 'Sure! How about 3pm at the usual place?', timestamp: Date.now() - 540_000, type: 'text', status: 'read' },
    { id: 'f2a', senderId: 'user-1', content: 'I also marked the address on the map.', timestamp: Date.now() - 420_000, type: 'image', attachmentName: 'coffee-location.png', attachmentMeta: 'Map screenshot' },
    { id: 'f2b', senderId: 'user-1', content: '', timestamp: Date.now() - 360_000, type: 'voice', durationSeconds: 14, transferState: 'ready' },
    { id: 'f2c', senderId: 'user-1', content: 'Design notes are up: https://design.peers-touch.dev/release-room', timestamp: Date.now() - 330_000, type: 'text' },
    { id: 'f3', senderId: 'user-1', content: 'Sounds good, see you tomorrow!', timestamp: Date.now() - 300_000, type: 'text' },
    ...Array.from({ length: 7 }, (_, index) => ({
      id: `f-photo-${index + 1}`,
      senderId: index % 2 === 0 ? 'user-1' : 'user-self',
      content: '',
      timestamp: Date.now() - (280_000 - index * 4_000),
      type: 'image' as const,
      attachmentName: `shared-${index + 1}.jpg`,
      attachmentMeta: 'Photo',
    })),
  ],
  'conv-7': [
    { id: 'b1', senderId: 'bob-aspen', content: 'Thanks for walking me through the setup.', timestamp: Date.now() - 260_000, type: 'text' },
    { id: 'b2', senderId: 'user-self', content: 'Anytime — happy to help!', timestamp: Date.now() - 240_000, type: 'text', status: 'read' },
    { id: 'b3', senderId: 'bob-aspen', content: 'See you at the team call.', timestamp: Date.now() - 200_000, type: 'text' },
  ],
  'conv-3': [
    { id: 'd1', senderId: 'user-1', content: 'Can you take a first pass at the rollout notes?', timestamp: Date.now() - 1_500_000, type: 'text' },
    { id: 'd2', senderId: 'user-3', content: 'Sure — I will share the draft this afternoon.', timestamp: Date.now() - 1_200_000, type: 'text' },
    { id: 'd3', senderId: 'user-self', content: 'Sounds good. I will review it tonight.', timestamp: Date.now() - 900_000, type: 'text', status: 'delivered' },
    { id: 'd4', senderId: 'user-5', content: 'mockup-v3.fig', timestamp: Date.now() - 600_000, type: 'file', attachmentName: 'mockup-v3.fig', attachmentMeta: 'Figma source · 2.4 MB' },
  ],
  'conv-4': [
    { id: 'p1', senderId: 'user-2', content: 'Can you review my PR?', timestamp: Date.now() - 3_900_000, type: 'text' },
    { id: 'p1v', senderId: 'user-2', content: '', timestamp: Date.now() - 3_750_000, type: 'voice', durationSeconds: 9, transferState: 'failed' },
    { id: 'p2', senderId: 'user-self', content: 'Looking now — will leave comments by noon.', timestamp: Date.now() - 3_600_000, type: 'text', status: 'failed' },
  ],
  'conv-5': [
    { id: 'pt1', senderId: 'user-4', content: 'Sprint planning moved to Friday.', timestamp: Date.now() - 7_800_000, type: 'text' },
    { id: 'pt2', senderId: 'user-self', content: 'I will join a few minutes late.', timestamp: Date.now() - 7_500_000, type: 'text', status: 'sent' },
    { id: 'pt3', senderId: 'system', content: 'You joined the group.', timestamp: Date.now() - 7_200_000, type: 'system' },
  ],
  'conv-6': [
    { id: 'l1', senderId: 'user-5', content: 'Thanks for the help!', timestamp: Date.now() - 86_600_000, type: 'text' },
    { id: 'l2', senderId: 'user-self', content: 'Anytime.', timestamp: Date.now() - 86_400_000, type: 'text', status: 'read' },
  ],
};

export const GROUP_MEMBERS: Record<string, MockGroupMember[]> = {
  'conv-1': [
    { userId: 'user-self', role: 'owner', muted: false, joinedAt: Date.now() - 8_640_000 },
    { userId: 'user-1', role: 'admin', muted: false, joinedAt: Date.now() - 7_200_000 },
    { userId: 'user-2', role: 'member', muted: false, joinedAt: Date.now() - 6_800_000 },
    { userId: 'user-3', role: 'member', muted: false, joinedAt: Date.now() - 6_400_000 },
    { userId: 'user-4', role: 'member', muted: true, joinedAt: Date.now() - 5_900_000 },
    { userId: 'user-5', role: 'member', muted: false, joinedAt: Date.now() - 5_200_000 },
    { userId: 'user-6', role: 'member', muted: false, joinedAt: Date.now() - 4_600_000 },
    { userId: 'user-7', role: 'member', muted: false, joinedAt: Date.now() - 4_100_000 },
    { userId: 'user-8', role: 'member', muted: false, joinedAt: Date.now() - 3_600_000 },
  ],
  'conv-3': [
    { userId: 'user-1', role: 'owner', muted: false, joinedAt: Date.now() - 8_640_000 },
    { userId: 'user-self', role: 'admin', muted: false, joinedAt: Date.now() - 7_200_000 },
    { userId: 'user-3', role: 'member', muted: false, joinedAt: Date.now() - 6_400_000 },
    { userId: 'user-5', role: 'member', muted: false, joinedAt: Date.now() - 5_200_000 },
  ],
  'conv-5': [
    { userId: 'user-1', role: 'owner', muted: false, joinedAt: Date.now() - 8_640_000 },
    { userId: 'user-2', role: 'admin', muted: false, joinedAt: Date.now() - 7_200_000 },
    { userId: 'user-self', role: 'member', muted: false, joinedAt: Date.now() - 6_800_000 },
    { userId: 'user-3', role: 'member', muted: false, joinedAt: Date.now() - 6_400_000 },
    { userId: 'user-4', role: 'member', muted: true, joinedAt: Date.now() - 5_900_000 },
    { userId: 'user-5', role: 'member', muted: false, joinedAt: Date.now() - 5_200_000 },
    { userId: 'user-6', role: 'member', muted: false, joinedAt: Date.now() - 4_600_000 },
  ],
};

// ── Contacts book: friend requests + saved groups ───────────────
// Mirrors real apps/desktop ChatContactsPanel semantics.
// Status enum: 1 pending · 2 accepted · 3 rejected.
export type ContactRequestDirection = 'incoming' | 'outgoing';
export type ContactRequestStatus = 1 | 2 | 3;

export interface MockContactRequest {
  id: string;
  name: string;
  initials: string;
  identityKey: string;
  direction: ContactRequestDirection;
  status: ContactRequestStatus;
  attempts: number;
  message?: string;
  federationName?: string;
  homeStation?: string;
  handle?: string;
  /** Cross-station request; explicit (a same-station friend like local.dev stays unmarked). */
  federated?: boolean;
}

export const INITIAL_FRIEND_REQUESTS: MockContactRequest[] = [
  {
    id: 'cr-acceptance',
    name: 'Acceptance 9464d14b335d',
    initials: 'A',
    identityKey: 'ptid:acceptance-9464d14b335d',
    direction: 'incoming',
    status: 2,
    attempts: 2,
    federationName: 'Friends Federation',
    homeStation: 'acceptance.dev',
    handle: '@acceptance-9464@acceptance.dev',
    federated: true,
  },
  {
    id: 'cr-carol',
    name: 'Carol',
    initials: 'C',
    identityKey: 'ptid:carol-2f8a',
    direction: 'incoming',
    status: 2,
    attempts: 1,
    federationName: 'Friends Federation',
    homeStation: 'local.dev',
    handle: '@carol@local.dev',
  },
  {
    id: 'cr-dana',
    name: 'Dana Park',
    initials: 'DP',
    identityKey: 'ptid:dana-7c10',
    direction: 'incoming',
    status: 1,
    attempts: 1,
    message: "Let's reconnect after the federation upgrade.",
    federationName: 'Friends Federation',
    homeStation: 'relay-eu.dev',
    handle: '@dana@relay-eu.dev',
    federated: true,
  },
];

export interface MockSavedGroup {
  conversationId: string;
  name: string;
  memberCount: number;
}

export const SAVED_GROUPS: MockSavedGroup[] = [
  { conversationId: 'conv-3', name: 'Design Review', memberCount: 4 },
];
