/**
 * MobileApp domain model — clean product surface.
 *
 * Same layering as the desktop product and the evidence harness:
 * typed domain entities live here, seed/demo data is a pure factory, and
 * components never own business state (see state.ts). Nothing here imports
 * React; it is the headless contract the screens present.
 */

// Four bottom slots, mirroring the desktop side-rail order (messages → Agent
// → moments). Contacts are NOT a top-level tab: they are the second segment
// inside the messages surface (desktop ChatRail parity), reached via
// { tab:'chats', contactDetail }. The Agent slot is reserved — it opens an
// honest placeholder until the mobile Agent surface lands.
export type TabId = 'chats' | 'agent' | 'moments' | 'me';
export type MediaKind = 'audio' | 'video';

/** A secondary page pushed over a tab. Only one level deep — enhanced chains
    that would nest further are expressed inline (e.g. moment comments), never
    as another pushed page. */
export type ContactTarget = { kind: 'person' | 'group'; id: string };
export type Route =
  | { tab: 'chats'; conversationId?: string; contactDetail?: ContactTarget }
  | { tab: 'agent' }
  | { tab: 'moments' }
  | { tab: 'me'; setting?: 'station' | 'about' };

export interface Conversation {
  id: string;
  name: string;
  preview: string;
  time: string;
  unread: number;
  tone: string;
  group?: boolean;
  online?: boolean;
}

export interface ChatMessage {
  id: string;
  mine: boolean;
  text: string;
  time: string;
  file?: { name: string; size: string };
}

export interface MomentComment {
  id: string;
  author: string;
  tone: string;
  text: string;
  time: string;
}

export interface Moment {
  id: string;
  author: string;
  tone: string;
  time: string;
  text: string;
  likes: number;
  liked: boolean;
  comments: MomentComment[];
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
}

export interface Station {
  id: string;
  name: string;
  handle: string;
  online: boolean;
}

export interface SearchHit {
  kind: 'conversation' | 'person' | 'group' | 'moment';
  id: string;
  title: string;
  sub: string;
  tone: string;
  group?: boolean;
  online?: boolean;
}

export type CallState =
  | { status: 'idle' }
  | { status: 'outgoing'; conversationId: string; media: MediaKind }
  | { status: 'active'; conversationId: string; media: MediaKind; micMuted: boolean; cameraOff: boolean; elapsed: number };

export interface AppState {
  route: Route;
  searchOpen: boolean;
  newChatOpen: boolean;
  composerOpen: boolean;
  composerDraft: string;
  composerAudience: 'neighbors' | 'public';
  expandedComments: Record<string, boolean>;
  commentDrafts: Record<string, string>;
  openMomentMenu: string | null;
  conversations: Conversation[];
  messages: Record<string, ChatMessage[]>;
  moments: Moment[];
  people: Person[];
  groups: Group[];
  stations: Station[];
  currentStationId: string;
  /** Local prototype auth gate: true after 退出登录 until 重新登录. */
  signedOut: boolean;
  settings: { notify: boolean; sound: boolean; readReceipt: boolean; autoLock: string; language: string };
  call: CallState;
}

/** The station currently connected to; falls back to the first seed so the
    identity/settings surfaces always resolve a real station name. */
export function currentStation(state: AppState): Station {
  return state.stations.find(s => s.id === state.currentStationId) ?? state.stations[0];
}

/* ── seed ─────────────────────────────────────────────────────────────── */
/**
 * Avatar color discipline (north-star Pine 边界 §5): default identity tiles are
 * ONE neutral ink; the only chromatic tile is the user's own/brand identity,
 * which carries pine. No per-person picked colors — that palette was the
 * main source of the "demo" feel.
 */
export const AVATAR_INK = '#3d434a';
export const AVATAR_PINE = '#2f6a50';

// The viewer identity mirrors desktop Settings › Identity (林野 / @linye);
// 林晚 remains a separate seeded neighbor, as in the desktop world.
export const ME = { name: '林野', handle: '@linye · 松绿书屋站', tone: AVATAR_PINE };

/** Profile facts shared with the desktop identity card and profile popover. */
export const PROFILE = {
  username: '@linye',
  station: '松绿书屋站',
  localTag: '本机身份',
  ptid: 'ptid:3f9a7c21:8c2e04ab',
  posts: 12,
  follows: 86,
  followers: 104,
  joined: '2025-10',
};

export const SEED_CONVERSATIONS: Conversation[] = [
  { id: 'c-chenyu', name: '陈屿', preview: '周末书架见，我把薄荷分一盆给你。', time: '刚刚', unread: 2, tone: AVATAR_INK, online: true },
  { id: 'c-neighbor', name: '小区生活群', preview: '周禾：今天种子交换在三号楼架空层。', time: '9 分', unread: 4, tone: AVATAR_INK, group: true },
  { id: 'c-linwan', name: '林晚', preview: '[图片]', time: '32 分', unread: 0, tone: AVATAR_INK, online: true },
  { id: 'c-suhe', name: '苏禾', preview: '谢谢，资料我今晚看完。', time: '1 小时', unread: 0, tone: AVATAR_INK },
  { id: 'c-station', name: '松绿书屋站', preview: '设备关联已通过，可双向同步。', time: '昨天', unread: 0, tone: AVATAR_INK },
  { id: 'c-liannan', name: '连南', preview: '两跳外的连接已经建立。', time: '昨天', unread: 0, tone: AVATAR_INK },
];

export const SEED_MESSAGES: ChatMessage[] = [
  { id: 'm1', mine: false, text: '这周末去书架交换吗？', time: '18:45' },
  { id: 'm2', mine: true, text: '去，下午三点架空层见。', time: '18:46' },
  { id: 'm3', mine: false, text: '好，我带两盆薄荷苗。', time: '18:47' },
  { id: 'm4', mine: true, text: '那我带今年新收的南瓜种子。', time: '18:48' },
  { id: 'm5', mine: true, text: '', time: '18:48', file: { name: '种子清单.pdf', size: '2.4 MB' } },
  { id: 'm6', mine: false, text: '收到，明天见 🌿', time: '18:50' },
];

export const SEED_MOMENTS: Moment[] = [
  { id: 'mo-zhouhe', author: '周禾', tone: AVATAR_INK, time: '2 小时前', text: '今天把阳台的薄荷分了三盆，留一盆给自己，其余带去周五的种子交换。', likes: 24, liked: false, comments: [
    { id: 'cm1', author: '陈屿', tone: AVATAR_INK, text: '给我留一盆，我拿罗勒换。', time: '1 小时前' },
    { id: 'cm2', author: '苏禾', tone: AVATAR_INK, text: '架空层见。', time: '45 分前' },
  ] },
  { id: 'mo-suhe', author: '苏禾', tone: AVATAR_INK, time: '5 小时前', text: '松绿书屋站新装了离线中继，断网时留言也能在上线后送达。', likes: 18, liked: false, comments: [] },
  { id: 'mo-linwan', author: ME.name, tone: ME.tone, time: '昨天', text: '风筝夜拍，江边风很大，灯很稳。', likes: 41, liked: false, comments: [] },
];

export const SEED_PEOPLE: Person[] = [
  { id: 'p-chenyu', name: '陈屿', role: '邻居 · 三号楼', tone: AVATAR_INK, online: true },
  { id: 'p-zhouhe', name: '周禾', role: '书屋管理员', tone: AVATAR_INK },
  { id: 'p-linwan2', name: '林晚', role: '邻居 · 七号楼', tone: AVATAR_INK, online: true },
  { id: 'p-ayan', name: '阿砚', role: '植物医院 · 松绿书屋站', tone: AVATAR_INK },
  { id: 'p-suhe', name: '苏禾', role: '邻居 · 五号楼', tone: AVATAR_INK },
];

export const SEED_GROUPS: Group[] = [
  { id: 'g-neighbor', name: '小区生活群', members: 126, tone: AVATAR_INK },
  { id: 'g-seed', name: '种子交换', members: 48, tone: AVATAR_INK },
  { id: 'g-book', name: '松绿书屋', members: 32, tone: AVATAR_INK },
];

export const SEED_STATIONS: Station[] = [
  { id: 's-songlv', name: '松绿书屋站', handle: 'songlv.local · 本机', online: true },
  { id: 's-jiangbian', name: '江边中继站', handle: 'jiangbian · 两跳外', online: true },
  { id: 's-jiuxiang', name: '旧巷站', handle: 'jiuxiang · 三跳外', online: false },
];

/** Resolve a routed conversation id to a Conversation, synthesizing one for
    direct/group threads entered from contacts that aren't in the chat list. */
export function resolveConversation(state: AppState, id: string): Conversation | undefined {
  const existing = state.conversations.find(c => c.id === id);
  if (existing) return existing;
  if (id.startsWith('direct-')) {
    const personId = id.slice('direct-'.length);
    const p = state.people.find(x => x.id === personId);
    if (p) return { id, name: p.name, preview: '开始对话', time: '', unread: 0, tone: p.tone, online: p.online };
  }
  if (id.startsWith('group-')) {
    const groupId = id.slice('group-'.length);
    const g = state.groups.find(x => x.id === groupId);
    if (g) return { id, name: g.name, preview: `${g.members} 位成员`, time: '', unread: 0, tone: g.tone, group: true };
  }
  return undefined;
}

export function messagesFor(state: AppState, id: string) {
  return state.messages[id] ?? [];
}

export function createInitialState(): AppState {
  return {
    route: { tab: 'chats' },
    searchOpen: false,
    newChatOpen: false,
    composerOpen: false,
    composerDraft: '',
    composerAudience: 'neighbors',
    expandedComments: {},
    commentDrafts: {},
    openMomentMenu: null,
    conversations: SEED_CONVERSATIONS,
    // Seeded conversations carry the scripted thread; conversations created at
    // runtime (direct/group from contacts) start empty and fill on send.
    messages: Object.fromEntries(SEED_CONVERSATIONS.map(c => [c.id, c.id === 'c-chenyu' ? SEED_MESSAGES : []])),
    moments: SEED_MOMENTS,
    people: SEED_PEOPLE,
    groups: SEED_GROUPS,
    stations: SEED_STATIONS,
    currentStationId: 's-songlv',
    signedOut: false,
    settings: { notify: true, sound: false, readReceipt: true, autoLock: '5m', language: 'zh-CN' },
    call: { status: 'idle' },
  };
}
