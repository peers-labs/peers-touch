/**
 * Local fixtures for the north-star Moments feature.
 *
 * The prototype migrates the *full visible anatomy* of the desktop moments
 * subsystem (feed scope tabs, trust meta, reactions, comment preview,
 * composer, detail, people, circles, profile) but stays local: no station
 * connection, no proto types, every interaction mutates component state only.
 * Identity tones stand in for remote avatars/artwork via deterministic SVG.
 */

export type ReactionKind =
  | 'like' | 'love' | 'laugh' | 'celebrate' | 'wow' | 'clap' | 'fire'
  | 'heartHands' | 'thanks' | 'sad' | 'angry' | 'thinking' | 'hundred'
  | 'eyes' | 'strong' | 'check';

export interface ReactionMeta { readonly kind: ReactionKind; readonly emoji: string; readonly label: string }

export const REACTION_CATALOG: readonly ReactionMeta[] = [
  { kind: 'like', emoji: '\u{1F44D}', label: '赞' },
  { kind: 'love', emoji: '\u{2764}\u{FE0F}', label: '喜欢' },
  { kind: 'laugh', emoji: '\u{1F602}', label: '大笑' },
  { kind: 'celebrate', emoji: '\u{1F389}', label: '庆祝' },
  { kind: 'wow', emoji: '\u{1F62E}', label: '惊讶' },
  { kind: 'clap', emoji: '\u{1F44F}', label: '鼓掌' },
  { kind: 'fire', emoji: '\u{1F525}', label: '火热' },
  { kind: 'heartHands', emoji: '\u{1FAF6}', label: '比心' },
  { kind: 'thanks', emoji: '\u{1F64F}', label: '感谢' },
  { kind: 'sad', emoji: '\u{1F622}', label: '难过' },
  { kind: 'angry', emoji: '\u{1F621}', label: '生气' },
  { kind: 'thinking', emoji: '\u{1F914}', label: '想想' },
  { kind: 'hundred', emoji: '\u{1F4AF}', label: '满分' },
  { kind: 'eyes', emoji: '\u{1F440}', label: '围观' },
  { kind: 'strong', emoji: '\u{1F4AA}', label: '给力' },
  { kind: 'check', emoji: '\u{2705}', label: '参加' },
];

export const REACTION_BY_KIND: ReadonlyMap<ReactionKind, ReactionMeta> =
  new Map(REACTION_CATALOG.map(meta => [meta.kind, meta]));

export type AudienceKind = 'public' | 'followers' | 'friends' | 'circle' | 'self';
export type TrustReason = 'self' | 'following' | 'mutual' | 'circle' | 'public';

export interface MomentComment {
  id: string;
  author: string;
  tone: string;
  text: string;
  at: string;
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
  at: string;
  text: string;
  images?: string[];
  reactions: Partial<Record<ReactionKind, number>>;
  viewerReaction?: ReactionKind;
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
}

export interface Circle {
  id: string;
  name: string;
  desc: string;
  members: { id: string; name: string; tone: string }[];
}

/** Viewer identity (the rail avatar is the initial of this name). */
export const VIEWER = { name: '林野', tone: '#22302a' };

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
    id: 'mo-1', author: '林晚', tone: CLAY_1, source: 'local', reason: 'circle',
    audience: 'circle', circle: '小区生活圈', at: '刚刚 · 上海',
    text: '周末把阳台的薄荷分了三盆，留一盆给自己。把生活过成喜欢的样子，不需要很大的事。',
    images: [artwork(MINT_1, MINT_2, '\u{1F33F}')],
    reactions: { like: 24, love: 3 },
    comments: [
      { id: 'mo-1-c1', author: '周禾', tone: '#5f7d5a', text: '下周也教我扦插吧，我家那盆一直徒长。', at: '5 分钟前' },
      { id: 'mo-1-c2', author: '苏禾', tone: OLIVE_1, text: '想要一盆！种子交换日带给我？', at: '2 分钟前' },
    ],
  },
  {
    id: 'mo-2', author: '周禾', tone: '#5f7d5a', source: 'local', reason: 'mutual',
    audience: 'friends', at: '2 小时前 · 同站',
    text: '和邻居一起整理了小区共享书架，今天有人在架上放了一本我找了很久的诗集，扉页还留着上一位读者的批注。人和人这样接上的感觉真好——不需要认识很久，只需要在同一个地方认真生活过一阵。我们把书架编号重新刷了漆，又给儿童角加了两盏暖光灯。如果你家也有读完想流转的书，周末可以直接带来，登记一下就能上架。',
    reactions: { like: 58, laugh: 1, clap: 12 },
    comments: [
      { id: 'mo-2-c1', author: '林野', tone: VIEWER.tone, text: '诗集名字叫什么？我也想读。', at: '1 小时前' },
      { id: 'mo-2-c2', author: '林晚', tone: CLAY_1, text: '批注比诗本身还有意思。', at: '40 分钟前' },
      { id: 'mo-2-c3', author: '陈屿', tone: MINT_1, text: '周末我来帮忙刷第二层漆。', at: '20 分钟前' },
    ],
  },
  {
    id: 'mo-3', author: '苏禾', tone: OLIVE_1, source: 'local', reason: 'circle',
    audience: 'circle', circle: '种子交换', at: '今天 09:12',
    text: '番茄籽晒干了，周日种子交换见，想换罗勒和小葱。今年试着留了两代种，发芽率比去年稳。',
    images: [
      artwork(OLIVE_1, OLIVE_2, '\u{1F345}'),
      artwork(CLAY_1, CLAY_2, '\u{1F331}'),
      artwork(MINT_1, MINT_2, '\u{1F33C}'),
    ],
    reactions: { like: 17, check: 4 },
    comments: [
      { id: 'mo-3-c1', author: '老周', tone: '#8a7a55', text: '我有罗勒籽，到时候换。', at: '10:02' },
    ],
  },
  {
    id: 'mo-4', author: '陈屿', tone: MINT_1, source: 'local', reason: 'following',
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
      { id: 'mo-5-c1', author: '林晚', tone: CLAY_1, text: '周年快乐！', at: '昨天 09:01' },
    ],
  },
  {
    id: 'mo-6', author: 'lin · 连南', tone: SKY_1, source: 'local', reason: 'following',
    audience: 'public', at: '周一',
    text: '两跳外的连接已建立：我们小区的书架清单和你们共享了，有想流转的书可以互相寄。',
    reactions: { like: 12 },
    comments: [],
  },
  {
    id: 'mo-r1', author: '阿砚', tone: '#7a6a92', source: 'remote', station: '松绿书屋站',
    reason: 'public', federated: true, audience: 'public', at: '3 小时前 · 联邦',
    text: '我们社区做了一个「植物医院」角：养不好的盆栽可以寄放在这里，由轮值的邻居帮忙抢救，康复后再领回家。开张两周救回了七盆。',
    images: [artwork('#7a6a92', '#c2b4d6', '\u{1F335}')],
    reactions: { like: 121, clap: 18 },
    comments: [],
  },
  {
    id: 'mo-r2', author: '河埠头', tone: '#6f8fa6', source: 'remote', station: '河埠头站',
    reason: 'public', federated: true, audience: 'public', at: '昨天 · 联邦',
    text: '旧衣修补摊每月第一个周六开市，补丁布由大家捐的碎布头拼成，每件衣服都能拼出独一无二的纹样。',
    reactions: { like: 87, fire: 5 },
    comments: [],
  },
];

export const PEOPLE_SEEDS: Person[] = [
  { id: 'p-chenyu', name: '陈屿', tone: MINT_1, station: '本站', bio: '风筝夜拍 · 操场常客', mutual: true, followed: true },
  { id: 'p-zhouhe', name: '周禾', tone: '#5f7d5a', station: '本站', bio: '共享书架轮值 · 诗集爱好者', mutual: true, followed: true },
  { id: 'p-linwan', name: '林晚', tone: CLAY_1, station: '本站', bio: '阳台薄荷 · 手账', mutual: true, followed: true },
  { id: 'p-suhe', name: '苏禾', tone: OLIVE_1, station: '本站', bio: '自留种 · 番茄与罗勒', mutual: false, followed: false },
  { id: 'p-ayan', name: '阿砚', tone: '#7a6a92', station: '松绿书屋站', bio: '社区植物医院发起人', mutual: false, followed: false },
  { id: 'p-laozhou', name: '老周', tone: '#8a7a55', station: '本站', bio: '修自行车 · 罗勒种植户', mutual: false, followed: false },
];

export const CIRCLE_SEEDS: Circle[] = [
  {
    id: 'c-life', name: '小区生活圈', desc: '本小区邻居 · 书架、操场与日常互助',
    members: [
      { id: 'p-zhouhe', name: '周禾', tone: '#5f7d5a' },
      { id: 'p-linwan', name: '林晚', tone: CLAY_1 },
      { id: 'p-chenyu', name: '陈屿', tone: MINT_1 },
      { id: 'p-laozhou', name: '老周', tone: '#8a7a55' },
      { id: 'viewer', name: '林野', tone: VIEWER.tone },
    ],
  },
  {
    id: 'c-seeds', name: '种子交换', desc: '自留种交换与育苗经验',
    members: [
      { id: 'p-suhe', name: '苏禾', tone: OLIVE_1 },
      { id: 'p-laozhou', name: '老周', tone: '#8a7a55' },
      { id: 'viewer', name: '林野', tone: VIEWER.tone },
      { id: 'p-linwan', name: '林晚', tone: CLAY_1 },
    ],
  },
  {
    id: 'c-books', name: '流转书架', desc: '共享书架值守与书单维护',
    members: [
      { id: 'p-zhouhe', name: '周禾', tone: '#5f7d5a' },
      { id: 'p-chenyu', name: '陈屿', tone: MINT_1 },
      { id: 'viewer', name: '林野', tone: VIEWER.tone },
    ],
  },
];
