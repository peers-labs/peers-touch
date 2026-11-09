/**
 * MobileApp domain model — clean product surface.
 *
 * Same layering as the desktop product and the evidence harness: typed
 * domain entities live here, seed/demo data is a pure factory, and components
 * never own business state (see state.ts). Nothing here imports React; it is
 * the headless contract the screens present.
 *
 * Data is SINGLE-SOURCED with the desktop north-star prototype: identity
 * tones come from shared identity-tone, chat sessions/people from shared
 * chat-data, moments/circles/audience vocabulary from shared moments-data.
 * The mobile layer only adapts those shapes to its view models — it never
 * forks colors, casts or seeds.
 */
import {
  CONVERSATIONS, SEED_MESSAGES,
  type Conversation as SharedConversation,
} from '../../../../shared/ui-system/chat/chat-data';
import {
  MOMENT_SEEDS, PEOPLE_SEEDS, CIRCLE_SEEDS, GROUP_SEEDS, VIEWER, VIEWER_COVER,
  type Moment as SharedMoment, type Person as SharedMomentPerson,
  type Circle as SharedCircle, type AudienceGroup, type AudienceKind,
} from '../../../../shared/ui-system/moments/moments-data';
import type { ReactionKind } from '../../../../shared/chat-domain';
import {
  buildFixtureDecision, emptyAccessState,
  type AccessRuntimeState, type GateProfileId,
} from './accessGate';

export type { AudienceKind, ReactionKind };
/** Trust reason mirrors shared moments-data (why a post reached the viewer). */
export type TrustReason = 'self' | 'following' | 'mutual' | 'circle' | 'public';

// Bottom slots mirror the REAL mobile shell (MobileShell TAB_ICON_MAP):
// messages → moments → contacts → identity/settings. The desktop rail folds
// contacts inside messages; mobile real product gives contacts their own tab,
// and real functionality wins (ADR-4). Search is not a tab: each surface owns
// an in-place scope filter (header icon morphs into the field in place).
export type TabId = 'chats' | 'moments' | 'contacts' | 'settings';
export type MediaKind = 'audio' | 'video';

/** A secondary page pushed over a tab. Only one level deep — enhanced chains
    that would nest further are expressed inline (e.g. moment comments), never
    as another pushed page. */
export type ContactTarget = { kind: 'person' | 'group'; id: string };
export type Route =
  | { tab: 'chats'; conversationId?: string }
  | { tab: 'moments' }
  | { tab: 'contacts'; contactDetail?: ContactTarget }
  | { tab: 'settings'; setting?: 'credentials' | 'station' | 'about' };

export interface MemberTile {
  id: string;
  name: string;
  tone: string;
}

export interface Conversation {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: number;
  tone: string;
  kind: 'person' | 'group';
  online?: boolean;
  pinned?: boolean;
  muted?: boolean;
  /** Group conversations carry their composite member tiles. */
  members?: MemberTile[];
}

export interface ChatMessage {
  id: string;
  mine: boolean;
  text: string;
  time: string;
  /** Attached image data URLs (local prototype; rendered as a 九宫格). */
  images?: string[];
  /** Recorded voice note (real MediaRecorder blob; local prototype). */
  voice?: { url: string; durationSeconds: number };
  /** Group threads attribute each peer message to its sender. */
  senderName?: string;
  senderTone?: string;
  /** Centered service notice (join/leave/system), not a speech bubble. */
  service?: boolean;
  /** Epoch ms — drives the shared 4m30s edit/recall mutation window. */
  ts?: number;
  /** Canonical reaction state, shared with desktop (counts + viewer kinds). */
  reactions?: import('../../../../shared/chat-domain').ReactionState;
  /** Quoted source rendered as a left-rule block inside the bubble. */
  replyTo?: { who: string; text: string };
  pinned?: boolean;
  /** Device-local personal bookmark (no protocol object). */
  markedForLater?: boolean;
  edited?: boolean;
  /** Recalled messages collapse to a centered "你撤回了一条消息" notice. */
  recalled?: boolean;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  tone: string;
  online?: boolean;
}

export interface Group {
  id: string;
  name: string;
  members: number;
  tone: string;
  memberTiles: MemberTile[];
}

export interface Station {
  id: string;
  name: string;
  handle: string;
  online: boolean;
  /** Station-advertised access policy; drives the fixture decision shown by
      the launch gate after identity discovery. */
  gateProfile: GateProfileId;
}

/** Moments reuse the shared desktop Moment shape verbatim (audience,
    reactions, federated source, comments) so both surfaces can never fork. */
export type Moment = SharedMoment;
export type MomentComment = Moment['comments'][number];
export type Circle = SharedCircle;
export type AudienceTargetGroup = AudienceGroup;
export type MomentPerson = SharedMomentPerson;

export type CallState =
  | { status: 'idle' }
  | { status: 'outgoing'; conversationId: string; media: MediaKind }
  | { status: 'connecting'; conversationId: string; media: MediaKind }
  | { status: 'active'; conversationId: string; media: MediaKind; micMuted: boolean; cameraOff: boolean; elapsed: number };

/** Bottom-sheet overlays owned by the messages surface. They are global state
    (like composerOpen) because the host suppresses the tab bar while a sheet
    physically covers the tab-bar strip. */
export type ChatsSheet = 'none' | 'add-contact' | 'start-group';

export interface AppState {
  route: Route;
  chatsSheet: ChatsSheet;
  composerOpen: boolean;
  composerDraft: string;
  composerAudience: AudienceKind;
  composerCircleId: string;
  composerGroupId: string;
  composerActorIds: string[];
  /** Attached image data URLs for the post being composed; max 9 (九宫格). */
  composerImages: string[];
  /** Default-open comments per desktop; this records only user-collapsed cards. */
  commentsCollapsed: Record<string, boolean>;
  commentDrafts: Record<string, string>;
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  moments: Moment[];
  people: Person[];
  momentPeople: MomentPerson[];
  groups: Group[];
  circles: Circle[];
  audienceGroups: AudienceTargetGroup[];
  stations: Station[];
  currentStationId: string;
  /** Local prototype auth gate: true after 退出登录 until a GRANTED decision. */
  signedOut: boolean;
  /** Station access attempt projection (fixture decision machine). */
  access: AccessRuntimeState;
  settings: { notify: boolean; sound: boolean; readReceipt: boolean; autoLock: string };
  call: CallState;
}

/** The station currently connected to; falls back to the first seed so the
    identity/settings surfaces always resolve a real station name. */
export function currentStation(state: AppState): Station {
  return state.stations.find(s => s.id === state.currentStationId) ?? state.stations[0];
}

/* ── chat-data adapters (shared single source) ────────────────────────── */

function adaptConversation(c: SharedConversation): Conversation {
  return {
    id: c.id,
    name: c.name,
    preview: c.last,
    time: c.lastAt,
    unread: c.unread,
    tone: c.tone,
    kind: c.kind,
    online: c.online,
    pinned: c.pinned,
    muted: c.muted,
    members: c.kind === 'group'
      ? (c.members ?? []).map((m, i) => ({ id: `${c.id}-m${i}`, name: m.name, tone: m.tone }))
      : undefined,
  };
}

function adaptMessages(id: string): ChatMessage[] {
  return (SEED_MESSAGES[id] ?? []).map(m => ({
    id: m.id,
    mine: m.from === 'me',
    text: m.text,
    time: m.at,
    senderName: m.senderName,
    senderTone: m.senderTone,
    service: m.kind === 'service',
    // Desktop-parity message action state: the action sheet vocabulary is
    // derived from the shared catalog, so seeds carry the same reaction,
    // quote, pin and mutation fields as the desktop surface.
    ts: m.ts,
    reactions: m.reactions,
    replyTo: m.replyTo,
    pinned: m.pinned,
    markedForLater: m.markedForLater,
    edited: m.edited,
    recalled: m.recalled,
  }));
}

/* ── seed ─────────────────────────────────────────────────────────────── */
/** The viewer is the single pine identity tile — every other person owns a
    deterministic hue from the shared palette (identity-tone Pine §5). */
export const ME = { name: VIEWER.name, handle: '@linye · 松绿书屋站', tone: VIEWER.tone };

/** Profile facts shared with the desktop identity card and profile popover. */
export const PROFILE = {
  username: '@linye',
  station: '松绿书屋站',
  localTag: '本机身份',
  ptid: 'ptid:3f9a7c21:8c2e04ab',
  cover: VIEWER_COVER,
  posts: 12,
  follows: 86,
  followers: 104,
  joined: '2025-10',
};

function adaptPerson(p: SharedMomentPerson, onlineNames: Set<string>): Person {
  return {
    id: p.id,
    name: p.name,
    tone: p.tone,
    role: p.bio,
    online: onlineNames.has(p.name),
  };
}

export const SEED_STATIONS: Station[] = [
  { id: 's-songlv', name: '松绿书屋站', handle: 'songlv.local · 本机', online: true, gateProfile: 'login-full' },
  { id: 's-jiangbian', name: '江边中继站', handle: 'jiangbian · 两跳外', online: true, gateProfile: 'invite-then-login' },
  { id: 's-jiuxiang', name: '旧巷站', handle: 'jiuxiang · 三跳外', online: false, gateProfile: 'login-email' },
];

/** Resolve a routed conversation id to a Conversation, synthesizing one for
    direct/group threads entered from contacts that aren't in the chat list. */
export function resolveConversation(state: AppState, id: string): Conversation | undefined {
  const existing = state.conversations.find(c => c.id === id);
  if (existing) return existing;
  if (id.startsWith('direct-')) {
    const personId = id.slice('direct-'.length);
    const p = state.people.find(x => x.id === personId);
    if (p) return { id, name: p.name, preview: '开始对话', time: '', unread: 0, tone: p.tone, kind: 'person', online: p.online };
  }
  if (id.startsWith('group-')) {
    const groupId = id.slice('group-'.length);
    const g = state.groups.find(x => x.id === groupId);
    if (g) {
      return {
        id, name: g.name, preview: `${g.members} 位成员`, time: '', unread: 0,
        tone: g.tone, kind: 'group', members: g.memberTiles,
      };
    }
  }
  return undefined;
}

export function messagesFor(state: AppState, id: string) {
  return state.messages[id] ?? [];
}

/** Evidence scenarios inject AppState variants into the ONE product surface.
    They seed data/state only — the rendered UI is always MobileApp, never a
    second harness skin. */
export type ProductScenario =
  | 'default'
  | 'journey'
  | 'station-offline'
  | 'long-lists'
  | 'long-content'
  // Access gate evidence surfaces — each deep-links one Station-advertised
  // decision state, mirroring the native entry fixture vocabulary.
  | 'gate-login'
  | 'gate-login-email'
  | 'gate-login-oauth'
  | 'gate-invite'
  | 'gate-terms'
  | 'gate-custom'
  | 'gate-unavailable'
  | 'gate-blocked'
  | 'gate-failed'
  | 'gate-pending'
  | 'gate-session-expired'
  | 'gate-login-failed'
  | 'gate-oauth-progress'
  | 'gate-oauth-failed';

/** Scenario → gate profile/overrides for direct decision deep links. */
function scenarioAccess(scenario: ProductScenario): AccessRuntimeState | null {
  const attemptId = 'fixture-attempt';
  const gate = (profile: Parameters<typeof buildFixtureDecision>[0]) => ({
    ...emptyAccessState(),
    phase: 'gate' as const,
    attemptId,
    profile,
    decision: buildFixtureDecision(profile, attemptId),
  });
  switch (scenario) {
    case 'gate-login':
      return gate('login-full');
    case 'gate-login-email':
      return gate('login-email');
    case 'gate-login-oauth':
      return gate('login-oauth');
    case 'gate-invite':
      return gate('invite-then-login');
    case 'gate-terms':
      return gate('terms-schema');
    case 'gate-custom':
      return gate('custom-schema');
    case 'gate-unavailable':
      return gate('device-trust');
    case 'gate-blocked':
      return gate('blocked');
    case 'gate-failed':
      return gate('failed');
    case 'gate-pending':
      return gate('pending');
    case 'gate-session-expired':
      return { ...gate('login-full'), sessionExpired: true };
    case 'gate-login-failed':
      return { ...gate('login-full'), errorKey: 'mobile.auth.loginFailed' };
    case 'gate-oauth-progress':
      return { ...gate('login-oauth'), oauthPhase: 'awaiting_provider' };
    case 'gate-oauth-failed':
      return {
        ...gate('login-oauth'),
        oauthPhase: 'failed',
        oauthErrorKey: 'mobile.auth.oauthFailed',
      };
    default:
      return null;
  }
}

/** Deterministic long-list evidence seed: 240 conversations / people and a
    480-message thread, generated from the identity palette — same look per
    row as production seeds, only volume differs. */
const LONG_TONES = ['#46588f', '#9f6a2c', '#a6513c', '#2f7f8b', '#7c5a40', '#7451a0'];
function makeLongLists(): Pick<AppState, 'conversations' | 'messages' | 'people' | 'groups'> {
  const conversations: Conversation[] = Array.from({ length: 240 }, (_, i) => {
    const n = i + 1;
    const group = n % 3 === 0;
    const tone = LONG_TONES[i % LONG_TONES.length];
    return {
      id: `long-chat-${String(n).padStart(3, '0')}`,
      name: group ? `邻里群 ${n}` : `邻居 ${n}`,
      preview: group ? `成员 ${n}：本地长列表样本消息` : `本地长列表样本消息 ${n}`,
      time: n <= 2 ? `${n}m` : `${Math.min(n, 99)}h`,
      unread: n <= 4 ? (n % 3) + 1 : 0,
      tone,
      kind: group ? 'group' : 'person',
      online: n % 4 === 0,
      pinned: n === 1,
      members: group
        ? [{ id: 'a', name: '林野', tone: ME.tone }, { id: 'b', name: '周禾', tone: '#9f6a2c' },
          { id: 'c', name: '苏禾', tone: '#a6513c' }, { id: 'd', name: '陈屿', tone: '#46588f' }]
        : undefined,
    } as Conversation;
  });
  const messages: AppState['messages'] = {
    [conversations[0].id]: Array.from({ length: 480 }, (_, i) => ({
      id: `long-message-${String(i + 1).padStart(3, '0')}`,
      mine: i % 2 === 1,
      text: i % 7 === 0
        ? '这是一条用于检验长消息在窄屏中换行、气泡最大宽度与纵向节奏的本地样本，不应横向溢出。'
        : `本地样本消息 ${i + 1}`,
      time: '',
    })),
  };
  const people: Person[] = Array.from({ length: 240 }, (_, i) => ({
    id: `long-person-${i + 1}`,
    name: `邻居 ${i + 1}`,
    role: i % 2 ? `三号楼 · ${i + 1}` : `松绿书屋站 · ${i + 1}`,
    tone: LONG_TONES[i % LONG_TONES.length],
    online: i % 5 === 0,
  }));
  const groups = conversations.filter(c => c.kind === 'group').map(c => ({
    id: c.id, name: c.name, members: c.members?.length ?? 4, tone: c.tone, memberTiles: c.members ?? [],
  }));
  return { conversations, messages, people, groups };
}

export function createInitialState(scenario: ProductScenario = 'default'): AppState {
  const conversations = CONVERSATIONS.map(adaptConversation);
  const onlineNames = new Set(
    conversations.filter(c => c.kind === 'person' && c.online).map(c => c.name),
  );
  const long = scenario === 'long-lists' ? makeLongLists() : null;
  const injectedAccess = scenarioAccess(scenario);
  const state: AppState = {
    route: { tab: 'chats' },
    chatsSheet: 'none',
    composerOpen: false,
    composerDraft: '',
    composerAudience: 'public',
    composerCircleId: CIRCLE_SEEDS[0]?.id ?? '',
    composerGroupId: GROUP_SEEDS[0]?.id ?? '',
    composerActorIds: [],
    composerImages: [],
    commentsCollapsed: {},
    commentDrafts: {},
    conversations: long?.conversations ?? conversations,
    messages: long?.messages ?? Object.fromEntries(conversations.map(c => [c.id, adaptMessages(c.id)])),
    moments: MOMENT_SEEDS.map(m => ({ ...m })),
    people: long?.people ?? PEOPLE_SEEDS.map(p => adaptPerson(p, onlineNames)),
    momentPeople: PEOPLE_SEEDS.map(p => ({ ...p })),
    groups: long?.groups ?? conversations
      .filter(c => c.kind === 'group')
      .map(c => ({
        id: c.id,
        name: c.name,
        members: c.members?.length ?? 0,
        tone: c.tone,
        memberTiles: c.members ?? [],
      })),
    circles: CIRCLE_SEEDS.map(c => ({ ...c, members: c.members.map(m => ({ ...m })) })),
    audienceGroups: GROUP_SEEDS.map(g => ({ ...g })),
    stations: scenario === 'station-offline'
      ? SEED_STATIONS.map(s => s.id === 's-songlv' ? { ...s, online: false } : s)
      : SEED_STATIONS,
    currentStationId: 's-songlv',
    // First-run launch gate for journey evidence; gate-* scenarios deep-link a
    // specific access decision. The board/product default boots into the app.
    signedOut: scenario === 'journey' || scenario === 'station-offline' || injectedAccess !== null,
    access: injectedAccess ?? emptyAccessState(),
    settings: { notify: true, sound: false, readReceipt: true, autoLock: '5m' },
    call: { status: 'idle' },
  };
  if (scenario === 'long-content' && state.messages['cv-chenyu']) {
    state.messages['cv-chenyu'] = [
      ...state.messages['cv-chenyu'],
      { id: 'long-1', mine: false, text: '这是一条很长的本地会话标题与正文样本，用于检验窄屏下导航标题单行省略、气泡换行与不横向溢出。'.repeat(3), time: '' },
    ];
  }
  return state;
}
