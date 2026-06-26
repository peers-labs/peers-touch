/**
 * Mock data for the social chat prototype.
 * Represents realistic conversation and member states.
 */

export interface MockUser {
  id: string;
  name: string;
  avatar: string;
  online: boolean;
}

export interface MockMessage {
  id: string;
  senderId: string;
  content: string;
  timestamp: number;
  type: 'text' | 'image' | 'file';
  replyTo?: string;
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
}

export type MockGroupRole = 'owner' | 'admin' | 'member';

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
};

export const CONVERSATIONS: MockConversation[] = [
  {
    id: 'conv-1',
    type: 'group',
    name: 'Engineering Team',
    avatar: '',
    lastMessage: 'Sarah: Let me check the deployment logs',
    lastMessageTime: Date.now() - 120_000,
    unread: 3,
    muted: false,
    pinned: true,
    memberCount: 7,
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
  },
];

export const MESSAGES: Record<string, MockMessage[]> = {
  'conv-1': [
    { id: 'm1', senderId: 'user-3', content: 'The new build is ready for testing', timestamp: Date.now() - 600_000, type: 'text' },
    { id: 'm2', senderId: 'user-1', content: 'Great! I\'ll run the integration tests now', timestamp: Date.now() - 540_000, type: 'text' },
    { id: 'm3', senderId: 'user-self', content: 'I noticed a memory leak in the WebSocket handler, looking into it', timestamp: Date.now() - 480_000, type: 'text' },
    { id: 'm4', senderId: 'user-1', content: 'Oh that might explain the connection drops we\'ve been seeing', timestamp: Date.now() - 420_000, type: 'text' },
    { id: 'm5', senderId: 'user-4', content: 'Should we hold off on the release until that\'s fixed?', timestamp: Date.now() - 360_000, type: 'text' },
    { id: 'm6', senderId: 'user-self', content: 'Yeah, give me an hour. The issue is in the reconnection backoff logic', timestamp: Date.now() - 300_000, type: 'text' },
    { id: 'm7', senderId: 'user-3', content: 'Sounds good. I\'ll update the release notes in the meantime', timestamp: Date.now() - 240_000, type: 'text' },
    { id: 'm8', senderId: 'user-1', content: 'Let me check the deployment logs', timestamp: Date.now() - 120_000, type: 'text' },
  ],
  'conv-2': [
    { id: 'f1', senderId: 'user-1', content: 'Hey, are you free for coffee tomorrow?', timestamp: Date.now() - 600_000, type: 'text' },
    { id: 'f2', senderId: 'user-self', content: 'Sure! How about 3pm at the usual place?', timestamp: Date.now() - 540_000, type: 'text' },
    { id: 'f3', senderId: 'user-1', content: 'Sounds good, see you tomorrow!', timestamp: Date.now() - 300_000, type: 'text' },
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
    { userId: 'user-4', role: 'member', muted: false, joinedAt: Date.now() - 5_900_000 },
    { userId: 'user-5', role: 'member', muted: false, joinedAt: Date.now() - 5_200_000 },
    { userId: 'user-6', role: 'member', muted: false, joinedAt: Date.now() - 4_600_000 },
  ],
};
