/**
 * Local fixtures for the north-star Moments feature.
 *
 * The prototype migrates the *full visible anatomy* of the desktop moments
 * subsystem (feed scope tabs, trust meta, reactions, comment preview,
 * composer, detail, people, circles, profile) but stays local: no station
 * connection, no proto types, every interaction mutates component state only.
 * Identity tones stand in for remote avatars/artwork via deterministic SVG.
 */

// Reaction vocabulary is owned by the headless chat domain so chat and
// moments (desktop + mobile) share one kind list and emoji mapping.
export {
  REACTION_CATALOG,
  REACTION_BY_KIND,
  QUICK_REACTION_KINDS,
  REACTION_LABELS,
  reactionLabel,
  emojiForKind,
  kindForEmoji,
  type ReactionKind,
  type ReactionMeta,
} from '../../chat-domain';
import type { ReactionKind } from '../../chat-domain';

// Mirrors model/domain/social/post.proto Audience.Kind (8 kinds).
export type AudienceKind =
  | 'public' | 'followers' | 'friends' | 'circle'
  | 'group' | 'allow' | 'deny' | 'self';
export type TrustReason = 'self' | 'following' | 'mutual' | 'circle' | 'public';

export interface MomentComment {
  id: string;
  author: string;
  tone: string;
  text: string;
  at: string;
  /** Viewer-name set when the local viewer liked this comment. */
  likes?: string[];
  /** Flat one-level replies (a reply to a reply attaches to the root). */
  replies?: MomentComment[];
}

export interface Moment {
  id: string;
  author: string;
  tone: string;
  source: 'local' | 'remote';
  station?: string;
  reason: TrustReason;
  audience: AudienceKind;
  circle?: string;
  /** Audience.Kind == GROUP: target group-conversation display name. */
  group?: string;
  /** CUSTOM_ALLOW allow-list / CUSTOM_DENY subtract-list display names. */
  audienceActors?: string[];
  at: string;
  text: string;
  images?: string[];
  reactions: Partial<Record<ReactionKind, number>>;
  /** Multi-select: every kind the viewer chose on this post. Tapping a chosen kind again removes it. */
  viewerReactions?: ReactionKind[];
  comments: MomentComment[];
  federated?: boolean;
}

export interface Person {
  id: string;
  name: string;
  tone: string;
  station: string;
  bio: string;
  mutual: boolean;
  followed: boolean;
  /** Seeded follower count for this person's profile header. */
  followers: number;
  /** Viewer has blocked this actor; their posts leave every timeline. */
  blocked?: boolean;
}

/**
 * Audience GROUP targets — the local stand-in for chat.Group conversations
 * referenced by `Audience.group_conversation_id`. Unlike Circle these are
 * bidirectional shared spaces; the composer only picks which one can see it.
 */
export interface AudienceGroup {
  id: string;
  name: string;
  members: string[];
}

export const GROUP_SEEDS: AudienceGroup[] = [
  { id: 'g-books', name: '流转书架值日群', members: ['周禾', '陈屿', '林野'] },
  { id: 'g-seeds', name: '种子交换联络群', members: ['苏禾', '老周', '林晚', '林野'] },
  { id: 'g-yard', name: '小区业主互助群', members: ['周禾', '老周', '陈屿', '林野'] },
];

export interface Circle {
  id: string;
  name: string;
  desc: string;
  members: { id: string; name: string; tone: string }[];
}

/**
 * Avatar color discipline (north-star Pine 边界 §5): each identity owns a
 * deterministic hue from the shared identity palette; the viewer is the
 * single pine tile, groups stay neutral ink. Abstract photo stand-ins
 * (artwork()) stay chromatic — they are content, not identity.
 */
export { IDENTITY_INK, IDENTITY_PINE } from '../identity-tone';
import { IDENTITY_INK, IDENTITY_PINE } from '../identity-tone';

/** Viewer identity (the rail avatar is the initial of this name). */
export const VIEWER = { name: '林野', tone: IDENTITY_PINE };
export const VIEWER_NAME = VIEWER.name;

/** Deterministic abstract photo stand-in; keeps the prototype network-free. */
export function artwork(a: string, b: string, glyph: string): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='480' height='480'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
    `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
    `</linearGradient></defs>` +
    `<rect width='480' height='480' fill='url(#g)'/>` +
    `<circle cx='118' cy='120' r='150' fill='rgba(255,255,255,.20)'/>` +
    `<circle cx='392' cy='408' r='196' fill='rgba(0,0,0,.12)'/>` +
    `<path d='M70 330 Q240 200 410 330' stroke='rgba(255,255,255,.35)' stroke-width='10' fill='none' stroke-linecap='round'/>` +
    `<text x='50%' y='54%' text-anchor='middle' font-size='150'>${glyph}</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const MINT_1 = '#7fa68c';
const MINT_2 = '#b7d3c2';
const CLAY_1 = '#c98a5a';
const CLAY_2 = '#e3b78d';
const SKY_1 = '#7f99b0';
const SKY_2 = '#bcd0e0';
const OLIVE_1 = '#8a8456';
const OLIVE_2 = '#c3bd8e';

export const MOMENT_SEEDS: Moment[] = [
  {
    id: 'mo-1', author: '林晚', tone: '#2f7f8b', source: 'local', reason: 'circle',
    audience: 'circle', circle: '小区生活圈', at: '刚刚 · 上海',
    text: '周末把阳台的薄荷分了三盆，留一盆给自己。把生活过成喜欢的样子，不需要很大的事。',
    images: [artwork(MINT_1, MINT_2, '\u{1F33F}')],
    reactions: { like: 24, love: 3 },
    comments: [
      { id: 'mo-1-c1', author: '周禾', tone: '#9f6a2c', text: '下周也教我扦插吧，我家那盆一直徒长。', at: '5 分钟前',
        likes: ['林晚', '陈屿'],
        replies: [
          { id: 'mo-1-c1-r1', author: '老周', tone: '#7c5a40', text: '徒长就打顶，把顶端掐掉会分枝。', at: '4 分钟前', likes: ['周禾'] },
        ] },
      { id: 'mo-1-c2', author: '苏禾', tone: '#a6513c', text: '想要一盆！种子交换日带给我？', at: '2 分钟前' },
      { id: 'mo-1-c3', author: '陈屿', tone: '#46588f', text: '徒长是光照不够，我放窗台就好多了。', at: '3 分钟前' },
      { id: 'mo-1-c4', author: '老周', tone: '#7c5a40', text: '修自行车摊旁边阳光好，可以搬过去晒。', at: '6 分钟前' },
      { id: 'mo-1-c5', author: '阿砚', tone: '#7451a0', text: '植物医院也可以帮忙看徒长，松绿书屋站欢迎。', at: '8 分钟前' },
      { id: 'mo-1-c6', author: '林晚', tone: '#2f7f8b', text: '三盆有点多啦，分我一盆好不好。', at: '10 分钟前' },
      { id: 'mo-1-c7', author: '周禾', tone: '#9f6a2c', text: '我家罗勒也分你，周末书架见。', at: '12 分钟前' },
      { id: 'mo-1-c8', author: '河埠头', tone: '#50708c', text: '旧衣摊收了几个旧花盆，可以来拿。', at: '15 分钟前' },
      { id: 'mo-1-c9', author: '苏禾', tone: '#a6513c', text: '番茄苗也该分盆了，一起弄。', at: '18 分钟前' },
      { id: 'mo-1-c10', author: '陈屿', tone: '#46588f', text: '今晚风筝夜，操场见。', at: '20 分钟前' },
      { id: 'mo-1-c11', author: '林野', tone: VIEWER.tone, text: '谢谢大家，周末带薄荷苗来交换。', at: '刚刚' },
    ],
  },
  {
    id: 'mo-2', author: '周禾', tone: '#9f6a2c', source: 'local', reason: 'mutual',
    audience: 'friends', at: '2 小时前 · 同站',
    text: '和邻居一起整理了小区共享书架，今天有人在架上放了一本我找了很久的诗集，扉页还留着上一位读者的批注。人和人这样接上的感觉真好——不需要认识很久，只需要在同一个地方认真生活过一阵。我们把书架编号重新刷了漆，又给儿童角加了两盏暖光灯。如果你家也有读完想流转的书，周末可以直接带来，登记一下就能上架。',
    reactions: { like: 58, laugh: 1, clap: 12 },
    comments: [
      { id: 'mo-2-c1', author: '林野', tone: VIEWER.tone, text: '诗集名字叫什么？我也想读。', at: '1 小时前', likes: ['林野', '陈屿'] },
      { id: 'mo-2-c2', author: '林晚', tone: '#2f7f8b', text: '批注比诗本身还有意思。', at: '40 分钟前' },
      { id: 'mo-2-c3', author: '陈屿', tone: '#46588f', text: '周末我来帮忙刷第二层漆。', at: '20 分钟前' },
    ],
  },
  {
    id: 'mo-3', author: '苏禾', tone: '#a6513c', source: 'local', reason: 'circle',
    audience: 'circle', circle: '种子交换', at: '今天 09:12',
    text: '番茄籽晒干了，周日种子交换见，想换罗勒和小葱。今年试着留了两代种，发芽率比去年稳。',
    images: [
      artwork(OLIVE_1, OLIVE_2, '\u{1F345}'),
      artwork(CLAY_1, CLAY_2, '\u{1F331}'),
      artwork(MINT_1, MINT_2, '\u{1F33C}'),
    ],
    reactions: { like: 17, check: 4 },
    comments: [
      { id: 'mo-3-c1', author: '老周', tone: '#7c5a40', text: '我有罗勒籽，到时候换。', at: '10:02' },
    ],
  },
  {
    id: 'mo-4', author: '陈屿', tone: '#46588f', source: 'local', reason: 'following',
    audience: 'followers', at: '昨天 21:40',
    text: '今晚的小区操场，有人放起了风筝，灯线在风里一闪一闪。站着看了十分钟，像回到小时候。',
    images: [
      artwork(SKY_1, SKY_2, '\u{1FA81}'),
      artwork('#4a6170', SKY_2, '\u{1F303}'),
    ],
    reactions: { like: 41, love: 9, wow: 2 },
    comments: [],
  },
  {
    id: 'mo-5', author: '林野', tone: VIEWER.tone, source: 'local', reason: 'self',
    audience: 'public', at: '昨天 08:20',
    text: '搬进来满一年。认识了卖花的阿婆、修自行车的师傅，还有一群在共享书架留批注的邻居。',
    reactions: { like: 33, celebrate: 6 },
    comments: [
      { id: 'mo-5-c1', author: '林晚', tone: '#2f7f8b', text: '周年快乐！', at: '昨天 09:01' },
    ],
  },
  {
    id: 'mo-6', author: 'lin · 连南', tone: '#2e8286', source: 'local', reason: 'following',
    audience: 'public', at: '周一',
    text: '两跳外的连接已建立：我们小区的书架清单和你们共享了，有想流转的书可以互相寄。',
    reactions: { like: 12 },
    comments: [],
  },
  {
    id: 'mo-r1', author: '阿砚', tone: '#7451a0', source: 'remote', station: '松绿书屋站',
    reason: 'public', federated: true, audience: 'public', at: '3 小时前 · 联邦',
    text: '我们社区做了一个「植物医院」角：养不好的盆栽可以寄放在这里，由轮值的邻居帮忙抢救，康复后再领回家。开张两周救回了七盆。',
    images: [artwork(IDENTITY_INK, '#c2b4d6', '\u{1F335}')],
    reactions: { like: 121, clap: 18 },
    comments: [],
  },
  {
    id: 'mo-r2', author: '河埠头', tone: '#50708c', source: 'remote', station: '河埠头站',
    reason: 'public', federated: true, audience: 'public', at: '昨天 · 联邦',
    text: '旧衣修补摊每月第一个周六开市，补丁布由大家捐的碎布头拼成，每件衣服都能拼出独一无二的纹样。',
    reactions: { like: 87, fire: 5 },
    comments: [],
  },
];

export const PEOPLE_SEEDS: Person[] = [
  { id: 'p-chenyu', name: '陈屿', tone: '#46588f', station: '本站', bio: '风筝夜拍 · 操场常客', mutual: true, followed: true, followers: 132 },
  { id: 'p-zhouhe', name: '周禾', tone: '#9f6a2c', station: '本站', bio: '共享书架轮值 · 诗集爱好者', mutual: true, followed: true, followers: 208 },
  { id: 'p-linwan', name: '林晚', tone: '#2f7f8b', station: '本站', bio: '阳台薄荷 · 手账', mutual: true, followed: true, followers: 96 },
  { id: 'p-suhe', name: '苏禾', tone: '#a6513c', station: '本站', bio: '自留种 · 番茄与罗勒', mutual: false, followed: false, followers: 41 },
  { id: 'p-ayan', name: '阿砚', tone: '#7451a0', station: '松绿书屋站', bio: '社区植物医院发起人', mutual: false, followed: false, followers: 377 },
  { id: 'p-laozhou', name: '老周', tone: '#7c5a40', station: '本站', bio: '修自行车 · 罗勒种植户', mutual: false, followed: false, followers: 58 },
];

export const CIRCLE_SEEDS: Circle[] = [
  {
    id: 'c-life', name: '小区生活圈', desc: '本小区邻居 · 书架、操场与日常互助',
    members: [
      { id: 'p-zhouhe', name: '周禾', tone: '#9f6a2c' },
      { id: 'p-linwan', name: '林晚', tone: '#2f7f8b' },
      { id: 'p-chenyu', name: '陈屿', tone: '#46588f' },
      { id: 'p-laozhou', name: '老周', tone: '#7c5a40' },
      { id: 'viewer', name: '林野', tone: VIEWER.tone },
    ],
  },
  {
    id: 'c-seeds', name: '种子交换', desc: '自留种交换与育苗经验',
    members: [
      { id: 'p-suhe', name: '苏禾', tone: '#a6513c' },
      { id: 'p-laozhou', name: '老周', tone: '#7c5a40' },
      { id: 'viewer', name: '林野', tone: VIEWER.tone },
      { id: 'p-linwan', name: '林晚', tone: '#2f7f8b' },
    ],
  },
  {
    id: 'c-books', name: '流转书架', desc: '共享书架值守与书单维护',
    members: [
      { id: 'p-zhouhe', name: '周禾', tone: '#9f6a2c' },
      { id: 'p-chenyu', name: '陈屿', tone: '#46588f' },
      { id: 'viewer', name: '林野', tone: VIEWER.tone },
    ],
  },
];
