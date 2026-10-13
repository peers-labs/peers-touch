/**
 * Demo data for the Mobile Prototype.
 */
import type { StationEntry, Conversation, Message, Moment, Contact, GroupItem } from './types';
import { GRADIENTS } from './types';
import {
  CHAT_JOURNEY,
  CHAT_JOURNEY_MESSAGE_ID,
  resolveChatJourneyLocale,
} from '../../../shared/chat-journey';

const chatJourneyLocale = typeof window === 'undefined'
  ? 'en'
  : resolveChatJourneyLocale(window.location.search, window.navigator.language);

/**
 * Avatars are deliberately not remote URLs: the prototype must render fully
 * offline (residual-parity gate blocks every cross-origin request) and must
 * stay consistent with the Desktop prototype, which uses deterministic
 * initial/tone avatars. IdentityAvatar renders the hashed-tone initials
 * fallback whenever the source is empty.
 */
export const demoAvatarUrls = {
  alice: '',
  bob: '',
  carol: '',
  david: '',
  emma: '',
  frank: '',
  grace: '',
  henry: '',
} as const;

// Media backgrounds are neutral local CSS gradients so no external image is
// fetched. Surfaces that need photography use the image fallback state.
export const demoMediaBackgrounds = {
  waterfront: 'linear-gradient(135deg, #dbe4f0, #b9c6da)',
  rooftopSunset: 'linear-gradient(135deg, #f3d9c2, #c98f6b)',
  colorSwatches: 'linear-gradient(135deg, #e7e2f2, #b6aede)',
  componentStudy: 'linear-gradient(135deg, #e2ece8, #9fb8ac)',
  tokenNotebook: 'linear-gradient(135deg, #eef0f4, #b9c0cc)',
  teamReview: 'linear-gradient(135deg, #e4e8f2, #aab4c6)',
} as const;

export const demoStations: StationEntry[] = [
  { url: 'http://localhost:9000', label: 'Local Station', online: true },
  { url: 'https://review.peers.social', label: 'Review Station', online: undefined },
];

export const demoConversations: Conversation[] = [
  { key: 'alice', name: 'Alice Chen', avatar: 'AC', avatarUrl: demoAvatarUrls.alice, avatarGradient: GRADIENTS[0], lastMessage: 'See you tomorrow at the meetup!', time: '2m', unread: 2, online: true, pinned: true },
  { key: 'dev-team', name: CHAT_JOURNEY.conversationName[chatJourneyLocale], avatar: 'RR', avatarGradient: GRADIENTS[1], lastMessage: CHAT_JOURNEY.messages.outbound[chatJourneyLocale], time: '2m', unread: 1, isGroup: true, canModerate: true, muted: false, pinned: true, lastSender: chatJourneyLocale === 'zh' ? '你' : 'You', memberCount: CHAT_JOURNEY.participants },
  { key: 'carol', name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol, avatarGradient: GRADIENTS[3], lastMessage: '[Photo]', time: '3h', unread: 0, online: true },
  { key: 'product', name: 'Product Design', avatar: 'PD', avatarGradient: GRADIENTS[4], lastMessage: 'design-spec-v3.pdf', time: '1d', unread: 0, isGroup: true, pinned: true, lastSender: 'Emma', memberCount: 8 },
  { key: 'bob', name: 'Bob Zhang', avatar: 'BZ', avatarUrl: demoAvatarUrls.bob, avatarGradient: GRADIENTS[2], lastMessage: 'Thanks for the feedback on the design', time: '1d', unread: 0, online: false },
  { key: 'david', name: 'David Wu', avatar: 'DW', avatarUrl: demoAvatarUrls.david, avatarGradient: GRADIENTS[5], lastMessage: 'Deployed to staging, ready for review', time: '2d', unread: 0, online: false },
  { key: 'design-systems', name: 'Design Systems', avatar: 'DS', avatarGradient: GRADIENTS[6], lastMessage: 'New token docs are up', time: '3d', unread: 0, isGroup: true, muted: true, lastSender: 'Carol', memberCount: 15 },
  { key: 'emma', name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma, avatarGradient: GRADIENTS[7], lastMessage: 'Lunch on Friday?', time: '4d', unread: 1, online: true },
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
  { id: 'm6', mine: true, image: demoMediaBackgrounds.waterfront, time: '6:42 PM', status: 'delivered' },
  { id: 'm7', mine: false, text: 'Love this view! Where was this taken?', time: '6:45 PM', status: 'read', reactions: [{ kind: 'love', byMe: true, count: 2 }, { kind: 'wow', byMe: false, count: 1 }] },
  { id: 'm8', mine: true, text: 'Took it at the waterfront park near the office', time: '6:46 PM', status: 'delivered' },
  { id: 'm9', mine: true, file: { name: 'design-spec-v3.pdf', size: '2.4 MB' }, time: '6:48 PM', status: 'sent' },
  { id: 'm10', mine: false, text: "Thanks, I'll review it tonight", time: '6:50 PM', status: 'read' },
  { id: 'm11', mine: true, text: 'No rush, we can discuss tomorrow', time: '6:52 PM', status: 'read' },
  { id: 'release-context', mine: false, text: chatJourneyLocale === 'zh' ? '我还在确认重连是否恢复。' : "I'm still verifying the reconnect.", time: '10:26 AM', status: 'read' },
  { id: 'release-question', mine: false, text: CHAT_JOURNEY.messages.inbound[chatJourneyLocale], time: '10:28 AM', status: 'read' },
  { id: CHAT_JOURNEY_MESSAGE_ID, mine: true, text: CHAT_JOURNEY.messages.outbound[chatJourneyLocale], time: '10:29 AM', status: 'read' },
  { id: 'release-hold-mobile-ack', mine: false, text: CHAT_JOURNEY.messages.followup[chatJourneyLocale], time: CHAT_JOURNEY.timestamps.recovered, status: 'read' },
];

export const directDemoMessages: Message[] = demoMessages.filter((message) => (
  !['m6', 'release-context', 'release-question', CHAT_JOURNEY_MESSAGE_ID, 'release-hold-mobile-ack']
    .includes(message.id)
));

export const deliveryRecoveryMessages: Message[] = demoMessages
  .filter((message) => message.id !== 'release-hold-mobile-ack')
  .map((message) => (
    message.id === CHAT_JOURNEY_MESSAGE_ID
      ? { ...message, status: 'failed' as const }
      : message
  ));

export const unknownOutcomeMessages: Message[] = demoMessages
  .filter((message) => message.id !== 'release-hold-mobile-ack')
  .map((message) => (
    message.id === CHAT_JOURNEY_MESSAGE_ID
      ? { ...message, status: 'unknown' as const }
      : message
  ));

export const demoMoments: Moment[] = [
  {
    id: 'mo1', name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol, avatarGradient: GRADIENTS[3], time: '2 hours ago',
    text: 'Just shipped the new onboarding flow. The team did an amazing job tightening up every interaction.',
    likes: 24, myReaction: 'like',
    reactionCounts: { like: 20, love: 3, celebrate: 1 },
    comments: [
      { id: 'c1', name: 'Alice Chen', avatar: 'AC', avatarUrl: demoAvatarUrls.alice, avatarGradient: GRADIENTS[0], text: 'Looks great! The flow is so smooth now.', time: '1h' },
      { id: 'c2', name: 'Bob Zhang', avatar: 'BZ', avatarUrl: demoAvatarUrls.bob, avatarGradient: GRADIENTS[2], text: 'Congrats on shipping!', time: '45m' },
    ],
  },
  {
    id: 'mo2', name: 'Bob Zhang', avatar: 'BZ', avatarUrl: demoAvatarUrls.bob, avatarGradient: GRADIENTS[2], time: '5 hours ago',
    text: 'Sunset from the office rooftop today. Never gets old.', likes: 56,
    reactionCounts: { like: 30, love: 22, wow: 4 },
    comments: [
      { id: 'c3', name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma, avatarGradient: GRADIENTS[7], text: 'Stunning view!', time: '4h' },
      { id: 'c4', name: 'David Wu', avatar: 'DW', avatarUrl: demoAvatarUrls.david, avatarGradient: GRADIENTS[5], text: 'Need to get up there sometime', time: '3h' },
    ],
  },
  {
    id: 'mo3', name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma, avatarGradient: GRADIENTS[7], time: 'Yesterday',
    text: 'Exploring color palettes for the next release. Leaning warm and muted.', likes: 31,
    reactionCounts: { like: 25, love: 6 },
    comments: [
      { id: 'c5', name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol, avatarGradient: GRADIENTS[3], text: 'The middle one is gorgeous', time: '20h' },
    ],
  },
  {
    id: 'mo4', name: 'David Wu', avatar: 'DW', avatarUrl: demoAvatarUrls.david, avatarGradient: GRADIENTS[5], time: '2 days ago',
    text: 'New blog post: Building resilient federated networks. Link in bio.', likes: 18,
    reactionCounts: { like: 18 },
    comments: [],
  },
  {
    id: 'mo5', name: 'Design Systems', avatar: 'DS', avatarGradient: GRADIENTS[6], time: '3 days ago',
    text: 'Token documentation is live. Components are now fully themeable through the new token pipeline.',
    likes: 42, myReaction: 'celebrate',
    reactionCounts: { like: 30, love: 8, celebrate: 4 },
    comments: [
      { id: 'c6', name: 'Alice Chen', avatar: 'AC', avatarUrl: demoAvatarUrls.alice, avatarGradient: GRADIENTS[0], text: 'This is huge for the team.', time: '3d' },
    ],
  },
];

// ── Content-projection evidence (R1) ────────────────────────────
// Raw inbound values deliberately contain seed/transport strings. The
// presenter (contentProjection.ts) must convert them to human content; these
// raw strings must never reach preview/body/author slots verbatim.
export const contentProjectionConversations: Conversation[] = [
  { key: 'cp-bob', name: 'Bob Zhang', avatar: 'BZ', avatarUrl: demoAvatarUrls.bob, avatarGradient: GRADIENTS[2], lastMessage: '😀', time: '12m', unread: 1, online: true },
  { key: 'cp-carol', name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol, avatarGradient: GRADIENTS[3], lastMessage: 'MWPU Carol to Alice 1791856217298', time: '56m', unread: 0, online: true },
  { key: 'cp-photo', name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma, avatarGradient: GRADIENTS[7], lastMessage: '[Photo]', time: '1h', unread: 0, online: true },
  { key: 'cp-file', name: 'Product Design', avatar: 'PD', avatarGradient: GRADIENTS[4], lastMessage: 'design-spec-v3.pdf', time: '2h', unread: 0, isGroup: true, pinned: true, lastSender: 'David', memberCount: 8 },
  { key: 'cp-system', name: 'Station Notice', avatar: 'SN', avatarGradient: GRADIENTS[6], lastMessage: '10.37.94.156:18132 federation sync 1791727923410', time: '1d', unread: 0 },
];

export const contentProjectionMessages: Message[] = [
  { id: 'cp-d1', mine: false, time: '', dateLabel: 'Today' },
  { id: 'cp-m1', mine: false, text: 'Hey, can you confirm the build landed?', time: '10:24 AM', status: 'read' },
  { id: 'cp-m2', mine: false, text: '😀', time: '10:25 AM', status: 'read' },
  { id: 'cp-m3', mine: false, image: demoMediaBackgrounds.waterfront, time: '10:26 AM', status: 'read' },
  { id: 'cp-m4', mine: false, file: { name: 'design-spec-v3.pdf', size: '2.4 MB' }, time: '10:27 AM', status: 'read' },
  { id: 'cp-m5', mine: false, text: 'MWPU Alice to Carol 1791856217298', time: '10:28 AM', status: 'read' },
  { id: 'cp-m6', mine: false, text: '10.37.94.156:18132 federation sync 1791727923410', time: '10:29 AM', status: 'read' },
  { id: 'cp-m7', mine: true, text: 'Build is green and the preview shows human content only.', time: '10:31 AM', status: 'delivered' },
];

export const demoContacts: Contact[] = [
  { key: 'alice', name: 'Alice Chen', avatar: 'AC', avatarUrl: demoAvatarUrls.alice, avatarGradient: GRADIENTS[0], note: 'Product Designer', online: true },
  { key: 'bob', name: 'Bob Zhang', avatar: 'BZ', avatarUrl: demoAvatarUrls.bob, avatarGradient: GRADIENTS[2], note: 'Backend Engineer', online: false },
  { key: 'carol', name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol, avatarGradient: GRADIENTS[3], note: 'Mobile Developer', online: true },
  { key: 'david', name: 'David Wu', avatar: 'DW', avatarUrl: demoAvatarUrls.david, avatarGradient: GRADIENTS[5], note: 'DevOps Engineer', online: false },
  { key: 'emma', name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma, avatarGradient: GRADIENTS[7], note: 'Design Lead', online: true },
  { key: 'frank', name: 'Frank Zhao', avatar: 'FZ', avatarUrl: demoAvatarUrls.frank, avatarGradient: GRADIENTS[1], note: 'Frontend Engineer', online: false },
  { key: 'grace', name: 'Grace Kim', avatar: 'GK', avatarUrl: demoAvatarUrls.grace, avatarGradient: GRADIENTS[4], note: 'QA Engineer', online: true },
  { key: 'henry', name: 'Henry Wang', avatar: 'HW', avatarUrl: demoAvatarUrls.henry, avatarGradient: GRADIENTS[6], note: 'Product Manager', online: false },
];

export const demoGroups: GroupItem[] = [
  { key: 'dev-team', name: 'Dev Team', avatar: 'DT', avatarGradient: GRADIENTS[1], memberCount: 12 },
  { key: 'product', name: 'Product Design', avatar: 'PD', avatarGradient: GRADIENTS[4], memberCount: 8 },
  { key: 'design-systems', name: 'Design Systems', avatar: 'DS', avatarGradient: GRADIENTS[6], memberCount: 15 },
];
