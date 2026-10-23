/**
 * Search prototype mock data and query logic (closed search domain D-19).
 *
 * Peers-Touch is a decentralized *social* network: the mock world is friends,
 * interest circles, life posts, cross-station federated friends, personal
 * Agents, private collections, and life-scoped settings — not enterprise
 * messaging (no release rooms, HR docs, or spreadsheets).
 *
 * Contains only Peers-Touch domain objects: messages / people / conversations
 * / social posts / Agents / knowledge / in-domain attachments / functions.
 * No web results and no OS files outside Peers.
 *
 * Actor visibility simulates the current account's read-policy hydration:
 * objects outside the actor's permission never appear in titles, snippets,
 * counts, or suggestions.
 */

export type SearchKind =
  | 'message'
  | 'person'
  | 'conversation'
  | 'social'
  | 'agent'
  | 'knowledge'
  | 'attachment'
  | 'applet'
  | 'function';

/** D = device-private; S = authorized on the local station; F = federated authorization. */
export type TrustZone = 'D' | 'S' | 'F';

export interface SearchResult {
  id: string;
  kind: SearchKind;
  title: string;
  snippet: string;
  /** Owning object (conversation / Agent / collection name) for meta and anchoring. */
  container: string;
  author?: string;
  time: string;
  zone: TrustZone;
  /** Shell page navigated to on open. */
  targetPage: 'chat' | 'agent' | 'moments' | 'settings' | 'applets';
  /** Anchor description surfaced via toast in the prototype. */
  anchor: string;
  /**
   * Actor visibility: owner = current account only; member = any same-station
   * friend can see; federation = visible inside the connected federation.
   * Simulates read-policy hydration.
   */
  visibility: 'owner' | 'member' | 'federation';
  /** Whether the message/attachment is device-private E2EE content restored locally. */
  devicePrivate?: boolean;
}

export interface SearchSuggestion {
  id: string;
  kind: SearchKind;
  label: string;
  meta: string;
  visibility: SearchResult['visibility'];
  targetPage: SearchResult['targetPage'];
  anchor: string;
}

export interface RecentObject {
  id: string;
  kind: SearchKind;
  label: string;
  meta: string;
  targetPage: SearchResult['targetPage'];
  anchor: string;
  visibility: SearchResult['visibility'];
}

export const ACTORS = [
  { id: 'owner', name: '我', sub: '当前账号 · ptid:person:owner' },
  { id: 'member', name: '站友视角', sub: '演示账号 · 另一站友 ptid:person:friend' },
] as const;

export type ActorId = (typeof ACTORS)[number]['id'];

const RESULTS: SearchResult[] = [
  {
    id: 'm-01',
    kind: 'message',
    title: '这周六徒步改到早上八点，林场北门集合',
    snippet: '…日出段要赶在云起来之前，大家带够 1.5L 水，下山去老马家吃手抓…',
    container: '周末徒步',
    author: '阿哲',
    time: '今天 10:42',
    zone: 'S',
    targetPage: 'chat',
    anchor: '周末徒步群 · 今天 10:42 · 阿哲的消息（高亮定位）',
    visibility: 'member',
  },
  {
    id: 'm-02',
    kind: 'message',
    title: '那家居酒屋订到周五晚上七点了',
    snippet: '…还是你上次说的吧台位，老板说可以带那张黑胶去放…',
    container: '与 苏念 的私聊',
    author: '苏念',
    time: '昨天 21:14',
    zone: 'D',
    targetPage: 'chat',
    anchor: '与 苏念 的私聊 · 昨天 21:14 · 端到端加密消息（本机已恢复）',
    visibility: 'owner',
    devicePrivate: true,
  },
  {
    id: 'm-04',
    kind: 'message',
    title: '雨崩徒步的离线轨迹我导好私发你了',
    snippet: '…两段轨迹都在这条消息里，只有你这台设备能打开，到村里没信号也能用…',
    container: '与 苏念 的私聊',
    author: '苏念',
    time: '周六 16:20',
    zone: 'D',
    targetPage: 'chat',
    anchor: '与 苏念 的私聊 · 周六 16:20 · 端到端加密消息（本机已恢复）',
    visibility: 'owner',
    devicePrivate: true,
  },
  {
    id: 'p-01',
    kind: 'person',
    title: '苏念',
    snippet: '同站好友 · 胶片摄影交流群成员',
    container: '联系人',
    time: '',
    zone: 'S',
    targetPage: 'chat',
    anchor: '打开与 苏念 的会话',
    visibility: 'member',
  },
  {
    id: 'c-01',
    kind: 'conversation',
    title: '周末徒步',
    snippet: '36 位成员 · 最后消息：今天 10:42',
    container: '兴趣群',
    time: '今天 10:42',
    zone: 'S',
    targetPage: 'chat',
    anchor: '打开兴趣群「周末徒步」最近消息',
    visibility: 'member',
  },
  {
    id: 's-01',
    kind: 'social',
    title: '雨崩三天两夜徒步 vlog 剪好了',
    snippet: '…冰湖线的日出放在 03:12，路线轨迹和住宿清单贴在评论区…',
    container: '阿哲 的动态',
    author: '阿哲',
    time: '昨天 22:05',
    zone: 'S',
    targetPage: 'moments',
    anchor: '动态详情 · 阿哲 · 雨崩徒步 vlog（定位到该帖与评论）',
    visibility: 'member',
  },
  {
    id: 'm-03',
    kind: 'message',
    title: '妈的体检报告我发你了，别往群里转',
    snippet: '…报告和影像都在这条消息里，只有你这台设备能打开…',
    container: '与 姐姐 的私聊',
    author: '姐姐',
    time: '周一 08:50',
    zone: 'D',
    targetPage: 'chat',
    anchor: '与 姐姐 的私聊 · 周一 08:50 · 端到端加密消息（其他账号不可见）',
    visibility: 'owner',
    devicePrivate: true,
  },
  {
    id: 'p-02',
    kind: 'person',
    title: 'Marta Silva',
    snippet: '@marta@madrid.social · 马德里站 · 已建立联邦',
    container: '联邦联系人',
    time: '',
    zone: 'F',
    targetPage: 'chat',
    anchor: '打开与 Marta Silva 的联邦会话（对端授权范围内）',
    visibility: 'federation',
  },
  {
    id: 's-02',
    kind: 'social',
    title: '新烘的耶加雪菲，酸质像橘子汽水',
    snippet: '…92 度水、三段注水，晒一下今天的早餐和唱片…',
    container: '苏念 的动态',
    author: '苏念',
    time: '周日 09:30',
    zone: 'S',
    targetPage: 'moments',
    anchor: '动态详情 · 苏念 · 咖啡与唱片（定位到该帖与评论）',
    visibility: 'member',
  },
  {
    id: 'c-02',
    kind: 'conversation',
    title: 'Camino 山友（联邦）',
    snippet: '128 位成员 · 马德里站与本站山友 · 最后消息：周末徒步集合点定了',
    container: '联邦兴趣群',
    time: '2 小时前',
    zone: 'F',
    targetPage: 'chat',
    anchor: '打开联邦群「Camino 山友」最近消息（对端授权范围内）',
    visibility: 'federation',
  },
  {
    id: 's-03',
    kind: 'social',
    title: '比利牛斯三段徒步路线，从难到易排好了',
    snippet: '…Ordesa 环线适合三天两夜，山口的湖要赶在七月雪化后去，照片在评论区…',
    container: 'Marta Silva 的联邦动态',
    author: 'Marta Silva',
    time: '周二 19:40',
    zone: 'F',
    targetPage: 'moments',
    anchor: '联邦动态 · Marta Silva · 比利牛斯徒步（对端授权范围内定位到该帖）',
    visibility: 'federation',
  },
  {
    id: 'a-01',
    kind: 'agent',
    title: '徒步路线助手：雨崩三天两夜怎么走？',
    snippet: '用户：十一去雨崩，三天两夜怎么安排？ 助手：D1 西当进住上雨崩，D2 冰湖看日出，D3 神瀑后出村…',
    container: 'Agent「徒步路线助手」会话',
    author: '徒步路线助手',
    time: '今天 09:18',
    zone: 'S',
    targetPage: 'agent',
    anchor: 'Agent「徒步路线助手」会话 · 今天 09:18 的轮次（定位到该 turn）',
    visibility: 'member',
  },
  {
    id: 'a-02',
    kind: 'agent',
    title: '我的日记助手：把今天的照片和动态写成日记',
    snippet: '…根据你今天的动态、照片和足迹整理成了一篇日记，仅保存在你的设备上…',
    container: 'Agent「日记助手」会话',
    author: '日记助手',
    time: '今天 08:02',
    zone: 'D',
    targetPage: 'agent',
    anchor: 'Agent「日记助手」会话 · 今天 08:02 的轮次（端侧私有）',
    visibility: 'owner',
    devicePrivate: true,
  },
  {
    id: 'k-01',
    kind: 'knowledge',
    title: '北海道冬旅住宿清单',
    snippet: '札幌、小樽、旭川、网走的候选旅店、价格区间与订房截止日…',
    container: '收藏 · 旅行',
    time: '10/20 更新',
    zone: 'S',
    targetPage: 'moments',
    anchor: '收藏「北海道冬旅住宿清单」（定位到条目）',
    visibility: 'member',
  },
  {
    id: 'k-02',
    kind: 'knowledge',
    title: '家人体检报告解读（仅自己可见）',
    snippet: '与周一私聊附件对应的指标备注与复查提醒，端侧保存，不上传 Station…',
    container: '我的收藏 · 私人',
    time: '周一 09:10',
    zone: 'D',
    targetPage: 'moments',
    anchor: '私人收藏「体检报告解读」（端侧私有，其他账号不可见）',
    visibility: 'owner',
    devicePrivate: true,
  },
  {
    id: 'att-01',
    kind: 'attachment',
    title: '林场日出.jpg',
    snippet: '随消息发送 · 2.4 MB · 周末徒步',
    container: '域内附件',
    time: '今天 10:15',
    zone: 'S',
    targetPage: 'chat',
    anchor: '周末徒步群内附件「林场日出.jpg」（随父消息授权打开）',
    visibility: 'member',
  },
  {
    id: 'att-02',
    kind: 'attachment',
    title: '体检报告.pdf',
    snippet: '随私聊消息发送 · 1.8 MB · 端到端私有',
    container: '域内附件',
    time: '周一 08:48',
    zone: 'D',
    targetPage: 'chat',
    anchor: '私聊附件「体检报告.pdf」（随父消息授权，不上传 Station）',
    visibility: 'owner',
    devicePrivate: true,
  },
  {
    id: 'f-01',
    kind: 'function',
    title: '隐私与权限',
    snippet: '设置 · 隐私 · 谁能找到我、谁能看我的动态与好友',
    container: '系统功能',
    time: '',
    zone: 'S',
    targetPage: 'settings',
    anchor: '打开「设置 → 隐私 → 隐私与权限」',
    visibility: 'member',
  },
  {
    id: 'f-02',
    kind: 'function',
    title: '通知与免打扰',
    snippet: '设置 · 通知 · 消息提醒、声音与免打扰时段',
    container: '系统功能',
    time: '',
    zone: 'S',
    targetPage: 'settings',
    anchor: '打开「设置 → 通知」',
    visibility: 'member',
  },
  {
    id: 'f-03',
    kind: 'function',
    title: '身份与站台',
    snippet: '设置 · 网络 · 我的 Station、被发现方式与联邦',
    container: '系统功能',
    time: '',
    zone: 'S',
    targetPage: 'settings',
    anchor: '打开「设置 → 网络」',
    visibility: 'member',
  },
  {
    id: 'f-04',
    kind: 'function',
    title: '新建 Agent',
    snippet: '创建一个只属于你的个人助手',
    container: '系统功能',
    time: '',
    zone: 'S',
    targetPage: 'agent',
    anchor: '打开 Agent 模块并进入新建流程',
    visibility: 'member',
  },
];

/** Simulates a source that is unavailable to another account (partial coverage). */
export const SOURCE_STATUS: Record<ActorId, { unavailable: string[] }> = {
  owner: { unavailable: [] },
  member: { unavailable: ['本机端到端内容'] },
};

export const KIND_LABEL: Record<SearchKind, string> = {
  message: '消息',
  person: '人',
  conversation: '会话',
  social: '动态',
  agent: 'Agent',
  knowledge: '知识',
  attachment: '附件',
  applet: 'Applet',
  function: '功能',
};

export const KIND_ORDER: SearchKind[] = [
  'person',
  'conversation',
  'message',
  'social',
  'agent',
  'knowledge',
  'attachment',
  'applet',
  'function',
];

/** Content kinds offered as filters in the "all" intent (functions excluded). */
export const CONTENT_KINDS: SearchKind[] = [
  'message',
  'person',
  'conversation',
  'social',
  'agent',
  'knowledge',
  'attachment',
  'applet',
];

function canSee(result: SearchResult, actor: ActorId): boolean {
  if (result.visibility === 'member') return true;
  if (result.visibility === 'owner') return actor === 'owner';
  // Both demo actors are inside the connected federation context.
  return true;
}

function matches(text: string, q: string): boolean {
  return q.trim().length > 0 && text.toLowerCase().includes(q.trim().toLowerCase());
}

export function searchResults(
  query: string,
  actor: ActorId,
  kindFilter: SearchKind | 'all' | 'functions',
): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  return RESULTS.filter((r) => canSee(r, actor)).filter((r) => {
    if (kindFilter === 'functions') return r.kind === 'function' && matches(`${r.title} ${r.snippet}`, q);
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false;
    if (kindFilter === 'all' && r.kind === 'function') return false;
    return matches(`${r.title} ${r.snippet} ${r.container} ${r.author ?? ''}`, q);
  });
}

export function suggestions(query: string, actor: ActorId): SearchSuggestion[] {
  const q = query.trim();
  if (!q) return [];
  return RESULTS.filter((r) => canSee(r, actor) && r.kind !== 'function')
    .filter((r) => matches(`${r.title} ${r.container} ${r.author ?? ''}`, q))
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.title,
      meta: r.kind === 'person' ? r.snippet : `${KIND_LABEL[r.kind]} · ${r.container}`,
      visibility: r.visibility,
      targetPage: r.targetPage,
      anchor: r.anchor,
    }));
}

export function recentObjects(actor: ActorId): RecentObject[] {
  return RESULTS.filter((r) => canSee(r, actor) && r.kind !== 'function')
    .slice(0, 5)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      label: r.title,
      meta: r.container,
      targetPage: r.targetPage,
      anchor: r.anchor,
      visibility: r.visibility,
    }));
}

export const QUICK_FUNCTIONS: SearchResult[] = RESULTS.filter((r) => r.kind === 'function');
