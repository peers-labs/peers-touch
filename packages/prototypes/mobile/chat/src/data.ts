/**
 * Demo data for the Mobile Prototype.
 */
import type { StationEntry, Conversation, Message, Moment, Contact, GroupItem } from './types';
import { GRADIENTS } from './types';

export const demoStations: StationEntry[] = [
  { url: 'http://localhost:9000', label: 'Local Station', online: true },
  { url: 'https://review.peers.social', label: 'Review Station', online: undefined },
];

export const demoConversations: Conversation[] = [
  { key: 'alice', name: 'Alice Chen', avatar: 'AC', avatarGradient: GRADIENTS[0], lastMessage: 'See you tomorrow at the meetup!', time: '2m', unread: 2, online: true, pinned: true },
  { key: 'dev-team', name: 'Dev Team', avatar: 'DT', avatarGradient: GRADIENTS[1], lastMessage: 'PR looks good, merging now', time: '18m', unread: 5, isGroup: true, muted: true, lastSender: 'Bob', memberCount: 12 },
  { key: 'carol', name: 'Carol Li', avatar: 'CL', avatarGradient: GRADIENTS[3], lastMessage: '[Photo]', time: '3h', unread: 0, online: true },
  { key: 'product', name: 'Product Design', avatar: 'PD', avatarGradient: GRADIENTS[4], lastMessage: 'design-spec-v3.pdf', time: '1d', unread: 0, isGroup: true, pinned: true, lastSender: 'Emma', memberCount: 8 },
  { key: 'bob', name: 'Bob Zhang', avatar: 'BZ', avatarGradient: GRADIENTS[2], lastMessage: 'Thanks for the feedback on the design', time: '1d', unread: 0, online: false },
  { key: 'david', name: 'David Wu', avatar: 'DW', avatarGradient: GRADIENTS[5], lastMessage: 'Deployed to staging, ready for review', time: '2d', unread: 0, online: false },
  { key: 'design-systems', name: 'Design Systems', avatar: 'DS', avatarGradient: GRADIENTS[6], lastMessage: 'New token docs are up', time: '3d', unread: 0, isGroup: true, muted: true, lastSender: 'Carol', memberCount: 15 },
  { key: 'emma', name: 'Emma Liu', avatar: 'EL', avatarGradient: GRADIENTS[7], lastMessage: 'Lunch on Friday?', time: '4d', unread: 1, online: true },
];

export const demoMessages: Message[] = [
  { id: 'd1', mine: false, time: '', dateLabel: 'Today' },
  { id: 'm1', mine: false, text: 'Hey! Are you coming to the meetup tomorrow?', time: '10:24 AM', status: 'read', threadCount: 3, threadReplies: [
    { id: 'tr1', mine: true, text: 'Yes, definitely going!', time: '10:25 AM', status: 'read' },
    { id: 'tr2', mine: false, text: 'Great, see you there. I will bring snacks.', time: '10:26 AM', status: 'read' },
    { id: 'tr3', mine: true, text: 'Awesome, looking forward to it', time: '10:28 AM', status: 'read' },
  ] },
  { id: 'm2', mine: true, text: 'Yes! Looking forward to it', time: '10:26 AM', status: 'read' },
  { id: 'm3', mine: false, text: "Great, I'll save you a seat. The talk on federated networks starts at 2pm.", time: '10:27 AM', status: 'read', reply: { name: 'You', text: 'Yes! Looking forward to it' } },
  { id: 'm4', mine: true, text: 'Perfect. Should I bring the prototype demo?', time: '10:28 AM', status: 'read', pinned: true },
  { id: 'm5', mine: false, text: 'Absolutely, everyone would love to see it', time: '10:30 AM', status: 'read', reactions: [{ kind: 'like', byMe: false, count: 1 }] },
  { id: 'd2', mine: false, time: '', dateLabel: 'Yesterday' },
  { id: 'm6', mine: true, image: GRADIENTS[2], time: '6:42 PM', status: 'delivered' },
  { id: 'm7', mine: false, text: 'Love this view! Where was this taken?', time: '6:45 PM', status: 'read', reactions: [{ kind: 'love', byMe: true, count: 2 }, { kind: 'wow', byMe: false, count: 1 }] },
  { id: 'm8', mine: true, text: 'Took it at the waterfront park near the office', time: '6:46 PM', status: 'delivered' },
  { id: 'm9', mine: true, file: { name: 'design-spec-v3.pdf', size: '2.4 MB' }, time: '6:48 PM', status: 'sent' },
  { id: 'm10', mine: false, text: "Thanks, I'll review it tonight", time: '6:50 PM', status: 'read' },
  { id: 'm11', mine: true, text: 'No rush, we can discuss tomorrow', time: '6:52 PM', status: 'read' },
];

export const demoMoments: Moment[] = [
  {
    id: 'mo1', name: 'Carol Li', avatar: 'CL', avatarGradient: GRADIENTS[3], time: '2 hours ago',
    text: 'Just shipped the new onboarding flow. The team did an amazing job tightening up every interaction.',
    likes: 24, myReaction: 'like',
    reactionCounts: { like: 20, love: 3, celebrate: 1 },
    comments: [
      { id: 'c1', name: 'Alice Chen', avatar: 'AC', avatarGradient: GRADIENTS[0], text: 'Looks great! The flow is so smooth now.', time: '1h' },
      { id: 'c2', name: 'Bob Zhang', avatar: 'BZ', avatarGradient: GRADIENTS[2], text: 'Congrats on shipping!', time: '45m' },
    ],
  },
  {
    id: 'mo2', name: 'Bob Zhang', avatar: 'BZ', avatarGradient: GRADIENTS[2], time: '5 hours ago',
    text: 'Sunset from the office rooftop today. Never gets old.', likes: 56,
    reactionCounts: { like: 30, love: 22, wow: 4 },
    images: [GRADIENTS[4]],
    comments: [
      { id: 'c3', name: 'Emma Liu', avatar: 'EL', avatarGradient: GRADIENTS[7], text: 'Stunning view!', time: '4h' },
      { id: 'c4', name: 'David Wu', avatar: 'DW', avatarGradient: GRADIENTS[5], text: 'Need to get up there sometime', time: '3h' },
    ],
  },
  {
    id: 'mo3', name: 'Emma Liu', avatar: 'EL', avatarGradient: GRADIENTS[7], time: 'Yesterday',
    text: 'Exploring color palettes for the next release. Leaning warm and muted.', likes: 31,
    reactionCounts: { like: 25, love: 6 },
    images: [GRADIENTS[5], GRADIENTS[6], GRADIENTS[0]],
    comments: [
      { id: 'c5', name: 'Carol Li', avatar: 'CL', avatarGradient: GRADIENTS[3], text: 'The middle one is gorgeous', time: '20h' },
    ],
  },
  {
    id: 'mo4', name: 'David Wu', avatar: 'DW', avatarGradient: GRADIENTS[5], time: '2 days ago',
    text: 'New blog post: Building resilient federated networks. Link in bio.', likes: 18,
    reactionCounts: { like: 18 },
    comments: [],
  },
  {
    id: 'mo5', name: 'Design Systems', avatar: 'DS', avatarGradient: GRADIENTS[6], time: '3 days ago',
    text: 'Token documentation is live. Components are now fully themeable through the new token pipeline.',
    likes: 42, myReaction: 'celebrate',
    reactionCounts: { like: 30, love: 8, celebrate: 4 },
    images: [GRADIENTS[1], GRADIENTS[3]],
    comments: [
      { id: 'c6', name: 'Alice Chen', avatar: 'AC', avatarGradient: GRADIENTS[0], text: 'This is huge for the team.', time: '3d' },
    ],
  },
];

export const demoContacts: Contact[] = [
  { key: 'alice', name: 'Alice Chen', avatar: 'AC', avatarGradient: GRADIENTS[0], note: 'Product Designer', online: true },
  { key: 'bob', name: 'Bob Zhang', avatar: 'BZ', avatarGradient: GRADIENTS[2], note: 'Backend Engineer', online: false },
  { key: 'carol', name: 'Carol Li', avatar: 'CL', avatarGradient: GRADIENTS[3], note: 'Mobile Developer', online: true },
  { key: 'david', name: 'David Wu', avatar: 'DW', avatarGradient: GRADIENTS[5], note: 'DevOps Engineer', online: false },
  { key: 'emma', name: 'Emma Liu', avatar: 'EL', avatarGradient: GRADIENTS[7], note: 'Design Lead', online: true },
  { key: 'frank', name: 'Frank Zhao', avatar: 'FZ', avatarGradient: GRADIENTS[1], note: 'Frontend Engineer', online: false },
  { key: 'grace', name: 'Grace Kim', avatar: 'GK', avatarGradient: GRADIENTS[4], note: 'QA Engineer', online: true },
  { key: 'henry', name: 'Henry Wang', avatar: 'HW', avatarGradient: GRADIENTS[6], note: 'Product Manager', online: false },
];

export const demoGroups: GroupItem[] = [
  { key: 'dev-team', name: 'Dev Team', avatar: 'DT', avatarGradient: GRADIENTS[1], memberCount: 12 },
  { key: 'product', name: 'Product Design', avatar: 'PD', avatarGradient: GRADIENTS[4], memberCount: 8 },
  { key: 'design-systems', name: 'Design Systems', avatar: 'DS', avatarGradient: GRADIENTS[6], memberCount: 15 },
];
