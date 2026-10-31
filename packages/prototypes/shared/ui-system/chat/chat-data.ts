/**
 * Local fixtures for the chat feature (increments 10–14). Mirrors the
 * visible data shapes of desktop social chat (sessions, contacts, friend
 * requests, groups, messages) without any station/IM transport.
 */

export type MessageAttachment = {
  id: string;
  kind: 'image' | 'file';
  name: string;
  mime: string;
  size: number;
  /** blob: preview for images; null for generic files */
  previewUrl: string | null;
};

export type DeliveryStatus = 'sending' | 'sent' | 'delivered' | 'read' | 'failed';

export type ChatMessage = {
  id: string;
  from: 'me' | 'peer';
  senderName?: string;
  senderTone?: string;
  text: string;
  at: string;
  /** Epoch ms; drives the 4m30s edit/recall window and relative times. */
  ts?: number;
  kind?: 'text' | 'service' | 'image' | 'voice' | 'link';
  status?: DeliveryStatus;
  edited?: boolean;
  recalled?: boolean;
  pinned?: boolean;
  image?: string;
  voiceSeconds?: number;
  /** Runtime blob URL for a locally recorded voice note; seed notes without a
      source stay playback-disabled (remote download not modelled). */
  voiceUrl?: string | null;
  attachments?: MessageAttachment[];
  link?: { title: string; url: string; desc: string };
  reactions?: Record<string, string[]>;
  replyTo?: { who: string; text: string };
  threadCount?: number;
};

export type Conversation = {
  id: string;
  name: string;
  last: string;
  lastAt: string;
  lastTs?: number;
  unread: number;
  tone: string;
  kind: 'person' | 'group';
  online?: boolean;
  pinned?: boolean;
  muted?: boolean;
  members?: { name: string; tone: string; role?: 'owner' | 'admin' | 'member' }[];
};

const NOW = Date.now();
const MIN = 60_000;

export const CONVERSATIONS: Conversation[] = [
  { id: 'cv-qun', name: '小区生活群', last: '周禾：周末书架见', lastAt: '09:32', lastTs: NOW - 32 * MIN, unread: 4, tone: '#a1824b', kind: 'group',
    pinned: true, members: [
      { name: '周禾', tone: '#3f6550', role: 'owner' },
      { name: '苏禾', tone: '#5d5a44', role: 'admin' },
      { name: '林晚', tone: '#c98a5a' },
      { name: '陈屿', tone: '#3f6550' },
    ] },
  { id: 'cv-chenyu', name: '陈屿', last: '[图片]', lastAt: '09:25', lastTs: NOW - 39 * MIN, unread: 1, tone: '#3f6550', kind: 'person', online: true },
  { id: 'cv-linwan', name: '林晚', last: '诗集散会我帮你留了位置', lastAt: '08:40', lastTs: NOW - 84 * MIN, unread: 2, tone: '#4a6170', kind: 'person', online: true },
  { id: 'cv-suhe', name: '苏禾', last: '薄荷分盆成功了，谢谢你', lastAt: '昨天', lastTs: NOW - 26 * 3600_000, unread: 0, tone: '#5d5a44', kind: 'person', muted: true, online: false },
  { id: 'cv-seed', name: '种子交换群', last: '本周日种子交换，记得来', lastAt: '昨天', lastTs: NOW - 30 * 3600_000, unread: 0, tone: '#7d8c4a', kind: 'group',
    members: [
      { name: '苏禾', tone: '#5d5a44', role: 'owner' },
      { name: '老周', tone: '#8a7a55' },
      { name: '陈屿', tone: '#3f6550' },
    ] },
  { id: 'cv-zhouhe', name: '周禾', last: '共享书架今日开放', lastAt: '周一', lastTs: NOW - 3 * 86400_000, unread: 0, tone: '#3f6550', kind: 'person', online: true },
  { id: 'cv-linnan', name: 'lin · 连南', last: '两跳外的连接已建立', lastAt: '10-26', lastTs: NOW - 5 * 86400_000, unread: 0, tone: '#6f8fa6', kind: 'person', online: false },
];

export type Person = {
  id: string;
  name: string;
  tone: string;
  station?: string;
  bio: string;
  mutual?: boolean;
};

export const PEOPLE: Person[] = [
  { id: 'p-chenyu', name: '陈屿', tone: '#3f6550', station: '本站', bio: '风筝夜拍 · 操场常客', mutual: true },
  { id: 'p-zhouhe', name: '周禾', tone: '#5f7d5a', station: '本站', bio: '共享书架轮值' },
  { id: 'p-suhe', name: '苏禾', tone: '#5d5a44', station: '本站', bio: '自留种 · 番茄育苗' },
  { id: 'p-laozhou', name: '老周', tone: '#8a7a55', station: '本站', bio: '修自行车 · 种子交换群主' },
  { id: 'p-ayan', name: '阿砚', tone: '#7a6a92', station: '松绿书屋站', bio: '社区植物医院发起人' },
  { id: 'p-laohe', name: '河埠头', tone: '#6f8fa6', station: '河埠头站', bio: '旧衣修补摊' },
];

export type FriendRequest = {
  id: string;
  name: string;
  tone: string;
  station: string;
  greeting: string;
  state: 'pending' | 'accepted' | 'rejected';
  /** Outgoing requests were sent by the local user; they render as "sent". */
  direction?: 'in' | 'out';
};

export const FRIEND_REQUESTS: FriendRequest[] = [
  { id: 'fr-1', name: '阿砚', tone: '#7a6a92', station: '松绿书屋站', greeting: '在植物医院帖里聊过，想加个邻居', state: 'pending' },
  { id: 'fr-2', name: '河埠头', tone: '#6f8fa6', station: '河埠头站', greeting: '修补摊想加入小区生活圈', state: 'pending' },
  { id: 'fr-3', name: '老周', tone: '#8a7a55', station: '本站', greeting: '交换个联系方式', state: 'accepted' },
  { id: 'fr-4', name: '林野', tone: '#4a6170', station: '夜跑小队 · 松绿书屋站', greeting: '', state: 'pending', direction: 'out' },
];

export type ThreadReply = { id: string; from: 'me' | 'peer'; senderName?: string; text: string; at: string };

export const SEED_THREADS: Record<string, ThreadReply[]> = {
  m1: [
    { id: 't1', from: 'peer', senderName: '苏禾', text: '我带两盆罗勒苗，可以放在架上交换。', at: '昨天 20:16' },
    { id: 't2', from: 'me', text: '好，我给你留最上层的位置。', at: '昨天 20:22' },
    { id: 't3', from: 'peer', senderName: '林晚', text: '那我把诗集摊也搬过去。', at: '昨天 20:30' },
  ],
};

export const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  'cv-chenyu': [
    { id: 'm1', from: 'peer', text: '周末种子交换你要来吗？我带了上次说的番茄籽。', at: '09:21', ts: NOW - 43 * MIN },
    { id: 'm2', from: 'me', text: '来，我把薄荷分一盆给你。', at: '09:24', ts: NOW - 40 * MIN, status: 'failed' },
    {
      id: 'm3', from: 'peer', at: '09:25', ts: NOW - 39 * MIN, kind: 'image',
      image: undefined, text: '[图片] 番茄育苗盘',
      link: { title: '番茄育苗注意事项', url: 'https://songshelf.local/tomato', desc: '催芽温度 25–28℃，出芽前保持基质湿润' },
    },
    { id: 'm4', from: 'peer', kind: 'service', text: '已保存在本机，等待发送。', at: '09:26', ts: NOW - 38 * MIN },
  ],
  'cv-qun': [
    { id: 's1', from: 'peer', kind: 'service', text: '林晚 通过 苏禾 的邀请加入了群聊', at: '周二', ts: NOW - 3 * 86400_000 },
    { id: 'm1', from: 'peer', senderName: '周禾', senderTone: '#3f6550', text: '周末书架见，记得带想交换的书。', at: '昨天 20:11', ts: NOW - 38 * 3600_000, threadCount: 3 },
    { id: 'm2', from: 'peer', senderName: '苏禾', senderTone: '#5d5a44', text: '我带两盆罗勒苗，先到先得。', at: '昨天 20:14', ts: NOW - 38 * 3600_000 + 180_000 },
    { id: 'm3', from: 'me', text: '我整理了一批绘本，周六搬到架上。', at: '昨天 20:20', ts: NOW - 38 * 3600_000 + 540_000, status: 'read', edited: true },
  ],
  'cv-linwan': [
    { id: 'm1', from: 'peer', text: '诗集散会我帮你留了位置。', at: '08:40', ts: NOW - 84 * MIN },
    { id: 'm2', from: 'me', text: '好，散会直接过来。', at: '08:42', ts: NOW - 82 * MIN, status: 'delivered' },
  ],
};
