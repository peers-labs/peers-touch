# Composite Promotion Pilot — Data Model（端口契约）

> **Status**: draft · **Owner**: Client Platform / UI System
> 本文件定义三个复合组件的 props 合同草图与 DOM 钩子保全清单。
> 类型名与字段在实现时可细化，但语义边界（纯数据、无 runtime 类型、无副作用）
> 不得突破。所有字段为合同草案，评审通过后在 `packages/ui/composite/src` 固化。

## 1. 通用端口类型

```ts
/** 宿主翻译函数；复合包不感知 i18n 框架。 */
export type CompositeTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** 复合组件区域标识，各组件在自己的 types 内收窄。 */
export type RegionKey = string;

/** 宿主注入的 legacy 类名与数据钩子，保证既有 gate/suite 选择器不断裂。 */
export interface SurfaceHooks<K extends RegionKey> {
  classNames?: Partial<Record<K, string>>;
  dataAttributes?: Partial<Record<K, Record<string, string | boolean | undefined>>>;
}
```

规则：

- view model 一律普通对象/数组，禁止传入 class 实例、Promise、AbortController；
  异步状态由宿主收敛成 `status: 'idle'|'loading'|'ready'|'error'` 判别联合。
- 回调不得返回业务 Promise 给组件（组件不 await）；宿主自行异步并通过新 props
  回灌状态。
- 可选插槽缺省时组件渲染内置空态/不渲染该区域，不得抛错。

## 2. GlobalSearchSurface

### 2.1 视图模型

```ts
export type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface SearchResultRow {
  /** 宿主内唯一行键（生产=searchRowKey；原型=person-xxx/conv-xxx）。 */
  rowKey: string;
  kind: 'person' | 'conversation' | 'message' | 'moment' | 'function' | 'content';
  title: string;
  snippet?: string;
  meta?: string;
  /** 命中高亮由组件按 query 切片，宿主只给纯文本。 */
  iconId?: string;            // ui 资产 iconId；无则按 kind 回退语义图标
  disabled?: boolean;
  /** 生产侧 gate 需要的资源标识，原样透传到行 dataAttributes 之外的固定字段。 */
  resource?: { id?: string; sourceId?: string; kind?: string };
}

export interface SearchGroup {
  key: string;               // person|conversation|message|moment|function|recent|quick
  labelKey: string;          // i18n key
  rows: SearchResultRow[];
  showCount?: boolean;
}

export interface SearchCoverage {
  zoneKey: 'device' | 'station' | 'federation';
  status?: 'delivered' | 'pending' | string;
  detailKey?: string;
}

export interface SearchSurfaceModel {
  query: string;
  status: SearchStatus;
  /** 空查询时的 recent/quick 分组；有查询时的结果分组。 */
  groups: SearchGroup[];
  empty: boolean;
  emptyTitleKey?: string;
  errorKey?: string | null;
  /** 生产 filter tabs（all/messages/social/attachments/functions）；原型传只读单值。 */
  filters: { id: string; labelKey: string; active: boolean }[];
  coverage: SearchCoverage[];
  pendingCoverage: SearchCoverage[];
  hasMore: boolean;
  opening: boolean;
  /** 受控 roving 光标；-1 = 输入框持有焦点。 */
  cursor: number;
  infoPopoverSlot?: ReactNode;   // 生产 coverage Popover 内容；原型不传
}
```

### 2.2 意图回调

```ts
export interface SearchSurfaceIntents {
  onQueryChange(query: string): void;
  onFilterChange(filterId: string): void;
  onSubmit(): void;
  onRetry(): void;
  onMore(): void;
  onOpenRow(rowKey: string): void;
  onCopyRow?(rowKey: string): void;
  onClose(): void;
  /** 光标变化上抛，宿主持久化 selectedKey；组件内部也保留瞬时键盘状态。 */
  onCursorChange(index: number): void;
}
```

### 2.3 区域键与钩子映射

`RegionKey`: `'overlay' | 'scrim' | 'panel' | 'field' | 'input' | 'close' |
'intents' | 'body' | 'group' | 'row' | 'empty' | 'error' | 'footer' | 'popover'`。

### 2.4 必须保全的选择器（verified_fact）

| 宿主 | 选择器/钩子 | 来源 |
|---|---|---|
| 生产 | `.pt-search-overlay` `.pt-search-scrim` `.pt-search-panel` `.pt-search-field` `.pt-search-body` `.pt-search-row` `.pt-search-footer` `.pt-search-empty` `.pt-search-error` `.pt-search-more` `.pt-search-intents` `.pt-search-info` `.pt-search-coverage` `.pt-search-popover` | gates：device_search_runner、device_search_e2e、content_search_desktop、native_interactions_static 等 |
| 生产 | `data-focus-boundary`、`data-search-filter`、`data-resource-id`、`data-source-id`、`data-resource-kind`、`id=pt-search-row-N`、`data-displayed-query` | 同上 + searchOverlayAlignment.test |
| 原型 | `[data-search-open]`、`[data-global-search]`、`[data-search-group=...]`、`[data-search-result]`、`[data-search-empty]`、`.sk-search-row`、`.sk-search-hit`、`.sk-search-boundary(-inline)` | north-star.suite `global-search-*` 7 场景 |

生产 `SearchResultMeta`、coverage Popover 内容、`SEARCH_FUNCTIONS` 留宿主，
经 `infoPopoverSlot`/行 meta 插槽进入；组件不内置任何搜索域知识。

## 3. IdentityProfileCard

### 3.1 视图模型（三态判别联合）

```ts
export type ProfileVariant = 'self' | 'author' | 'sheet';

export interface IdentityTechnicalDetail {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
}

export interface IdentityMoment {
  id: string;
  text: string;
  image?: string;
  at?: string;
}

export interface IdentityProfileModel {
  displayName: string;
  avatarSlot: ReactNode;            // CMP-D06：native 头像不进包
  handle?: { localPart: string; home?: string };
  stationLines?: string[];
  bio?: string;
  relation?: { label: string; tone?: 'success' | 'warning' | 'processing' | 'default' };
  badges?: { label: string; tone?: string }[];
  stats?: { label: string; value: number }[];
  tags?: string[];
  links?: { label?: string; url: string }[];
  joined?: string;
  region?: string;
  headerImage?: string;             // self banner
  technicalDetails?: IdentityTechnicalDetail[];
  technicalDetailsLabel?: string;
  /** author 态：最近动态条；self/sheet 不传。 */
  moments?: IdentityMoment[];
  isSelf: boolean;
}

export interface IdentityProfileIntents {
  onCopyTechnical?(detailId: string): void;   // 反馈由宿主 toast
  onOpenMoment?(momentId: string): void;
  onOpenProfile?(): void;
}

export interface IdentityProfileCardProps {
  variant: ProfileVariant;
  profile: IdentityProfileModel;
  /** 关系动作区（关注/发消息/拉黑/好友请求处理）整体由宿主拥有。 */
  actionsSlot?: ReactNode;
  intents: IdentityProfileIntents;
  t: CompositeTranslate;
  hooks?: SurfaceHooks<IdentityRegionKey>;
}
```

`IdentityRegionKey`: `'card' | 'banner' | 'avatar' | 'handle' | 'bio' |
'relation' | 'stats' | 'links' | 'actions' | 'technicalDetails' |
'technicalDetail' | 'copyButton' | 'moments' | 'momentTile'`。

### 3.2 必须保全的选择器

| 宿主 | 选择器/钩子 | 来源 |
|---|---|---|
| 生产 | `data-chat-profile-card`、`data-chat-avatar-ptid`、`data-chat-avatar-src`、`data-chat-profile-banner`、`data-profile-identity`、`data-chat-profile-relation`、`data-chat-profile-technical-details`、`data-chat-profile-technical-detail`、`data-chat-profile-copy`；类 `.pp-card--self/--author/--sheet` | profileCardAlignment.test、native_product_closure 等 gates |
| 生产动作 | `data-chat-profile-manage/requested/accept/add-friend`、`data-chat-contact-message`（留 ProfilePrimaryAction，actionsSlot 整体注入，钩子天然保留） | 同上 |
| 原型 | `data-author-name/self/seeded`、`data-author-moments`、`data-author-moment`、`data-author-follow/message/block/open`、`.sk-author-card` 等 | moments AuthorCard、chat ChatIdentity 消费方 + suite 间接断言 |

硬编码中文（粉丝/互相关注/最近动态/已关注/关注/发消息/拉黑/取消拉黑/
查看主页/查看我的主页）全部转 i18n key：生产进 `packages/locales`，
原型进 `prefs.ts` STRINGS。

## 4. ConversationRail 与 ConversationRow

### 4.1 范围切分

- **进复合件**：轨头（chats/contacts 分段、搜索瓦片展开/收起、plus 菜单槽）、
  Recent 标题、会话行单元（头像槽、presence、未读角标、置顶/静音标记、
  预览、时间、hover 快捷动作、行菜单/右键菜单）、空态/错误态容器。
- **留宿主**：contacts 面板（`contactsSlot`）、`ChatSearchDropdown`
  （`railExtraSlot`）、CreateGroup/FindPeople 弹窗、store 投影与排序、
  `OverlayCommitProfiler` 包裹、宽度样式（并行工作流敏感区）。

### 4.2 视图模型

```ts
export interface ConversationRowModel {
  id: string;
  kind: 'friend' | 'group';
  name: string;
  preview?: string;
  latestAt?: number;                         // 时间格式化由宿主完成后传字符串
  timeLabel: string;
  unread: number;
  muted: boolean;
  pinned: boolean;
  online?: boolean;
  selfDirect?: boolean;
  avatarSlot: ReactNode;                     // UserSquareAvatar / GroupSquareAvatar
  rowActions: MenuAction[];                  // 复用 @peers-touch/ui Menu 合同
  quickActions: { id: string; iconId: string; labelKey: string }[];
  hooks?: Record<string, string | boolean>;  // 行级 gate 钩子透传
}

export interface ConversationRailModel {
  tab: 'chats' | 'contacts';
  searchOpen: boolean;
  searchValue: string;
  recentLabelKey: string;
  rows: ConversationRowModel[];              // 宿主完成 pin-first 排序与过滤
  selectedRowKey: string | null;
  emptyKey?: string;
  error?: { titleKey: string; retryLabelKey: string } | null;
  plusMenuActions: MenuAction[];
}

export interface ConversationRailIntents {
  onTabChange(tab: 'chats' | 'contacts'): void;
  onOpenSearch(): void;
  onCloseSearch(): void;
  onSearchChange(value: string): void;
  onSelectRow(rowKey: string): void;
  onQuickAction(rowKey: string, actionId: string): void;
  onRowAction(rowKey: string, actionId: string): void;
  onRetry?(): void;
}

export interface ConversationRailSlots {
  contactsSlot?: ReactNode;                  // tab=contacts 时整体替换
  railExtraSlot?: ReactNode;                 // 生产 ChatSearchDropdown
}
```

### 4.3 区域键

`'pane' | 'header' | 'tabs' | 'searchTile' | 'searchField' | 'plusMenu' |
'title' | 'scroll' | 'row' | 'avatar' | 'unread' | 'presence' | 'preview' |
'rowActions' | 'empty' | 'error'`。

### 4.4 必须保全的选择器

| 宿主 | 选择器/钩子 | 来源 |
|---|---|---|
| 生产 | `.sc-sessions`（`data-chat-conversation-pane`，gates 40 处）、`data-rail-tab`、`data-rail-search`、`data-chat-session-search`、`data-rail-search-value`、`data-rail-search-trigger`、`data-chat-new-menu`、`data-pt-conversation-item`、`data-chat-conversation-kind`、`data-chat-session-ulid`、`data-chat-group-ulid`、`data-chat-conversation-preview/latest-at/unread`、`data-chat-session-unread(-lane)`、`data-chat-avatar-ptid/src`、`data-chat-identity-*`、`data-presence`、`data-pt-context-menu-*`、`data-chat-session-list-error(-mode)` | lifecycle_presence_layout、native_product_closure、chatRailAlignment 等 |
| 原型 | `.sk-conv-rail`、`.sk-rail-header`、`.sk-conv-list`、`.sk-conv-row`、`.sk-conv-item`、`data-conversation-kind`、`data-self-direct`、`data-pinned`、`data-muted`、`data-presence`、`data-unread`、`data-row-action`、`data-rail-search-value`、`data-session-count`、`.sk-unread-badge` | north-star.suite `conversation-rail/select` 等场景 |

### 4.5 不进试点的相邻合同（显式排除）

- `data-contact-section`、`data-contact-id`、`data-contact-group-id`、
  `data-request-*`、`data-self-direct-entry`：属 ContactsPane，留宿主。
- `data-session-delete-confirm`：原型删除确认 Dialog 留原型宿主；生产当前无
  删除菜单项（hide only），不新增功能。

## 5. 钩子保全的验证方式

- 复合包测试用 jsdom 挂载，断言 `surfaceHooks` 映射后每个清单内选择器可查询。
- Desktop 接线测试断言宿主传入的 hooks 常量与 gate 清单一致（常量集中在
  宿主适配文件，单一登记处）。
- native gate 不在试点内运行，但其选择器清单以本文件为合同；任何清单变更
  必须同时改本文件并在评审中说明，禁止在实现期静默增删。
