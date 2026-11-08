/**
 * Real capability registry — the single inventory behind the Frontend Eles
 * 基础元素 / 样本 / 套件 boards.
 *
 * It deliberately replaces the former 130-item paper catalogue: every entry
 * here is either IMPLEMENTED in @peers-touch/ui today, VETTED (implemented +
 * carrying a reviewed specimen + actually consumed by a prototype surface),
 * or a registered GAP that a prototype needs but the library does not own
 * yet. Nothing speculative, nothing with no path to a real surface.
 *
 * Promotion path: implemented → vetted after a state-matrix specimen is
 * reviewed and one prototype consumes it; gap → implemented when the
 * foundation increment lands BEFORE the prototype that needs it.
 */
export type CapabilityStatus = 'vetted' | 'implemented' | 'gap';
export type CapabilityKind = 'primitive' | 'composition';

export interface CapabilityRecord {
  /** Export name from @peers-touch/ui, or a stable gap id. */
  id: string;
  title: string;
  category: CategoryId;
  status: CapabilityStatus;
  kind: CapabilityKind;
  /** Prototype feature surfaces consuming it (status === 'vetted'). */
  consumedBy?: string[];
  /** Gap: which prototype surface proves the need. */
  neededBy?: string;
  note?: string;
}

export type CategoryId =
  | 'action' | 'input' | 'selection' | 'form' | 'overlay' | 'feedback'
  | 'data' | 'navigation' | 'layout' | 'content' | 'identity' | 'code' | 'advanced'
  | 'runtime';

export const CATEGORIES: { id: CategoryId; title: string }[] = [
  { id: 'action', title: '动作' },
  { id: 'input', title: '输入' },
  { id: 'selection', title: '选择' },
  { id: 'form', title: '表单' },
  { id: 'overlay', title: '浮层' },
  { id: 'feedback', title: '反馈与状态' },
  { id: 'data', title: '数据展示' },
  { id: 'navigation', title: '导航与展开' },
  { id: 'layout', title: '布局' },
  { id: 'content', title: '文字内容' },
  { id: 'identity', title: '身份与媒体' },
  { id: 'code', title: '代码与图表' },
  { id: 'advanced', title: '高级输入与运行时' },
  { id: 'runtime', title: '运行时' },
];

const CHAT = '桌面原型 · 消息';
const MOMENTS = '桌面原型 · 动态';
const SETTINGS = '桌面原型 · 设置';

/** Implemented primitives/components actually shipped in packages/ui/web. */
const IMPLEMENTED: Array<[CategoryId, string, string]> = [
  // action
  ['action', 'Button', '按钮：层级/危险/执行态'],
  ['action', 'IconButton', '图标按钮'],
  ['action', 'Link', '链接式动作'],
  ['action', 'Toggle', '可选中开关动作'],
  ['action', 'CopyButton', '复制按钮'],
  ['action', 'DownloadButton', '下载按钮'],
  ['action', 'ActionGroup', '动作组容器'],
  ['action', 'SplitButton', '主操作 + 备选菜单的分裂按钮'],
  // input
  ['input', 'TextField', '单行输入'],
  ['input', 'TextArea', '多行输入'],
  ['input', 'PasswordField', '口令输入'],
  ['input', 'NumberField', '数字输入'],
  ['input', 'OTPField', '验证码输入'],
  ['input', 'SearchField', '带提交的搜索框'],
  ['input', 'Slider', '滑杆'],
  ['input', 'Rating', '评分'],
  ['input', 'InlineEdit', '行内编辑'],
  ['input', 'ColorPicker', '颜色选择'],
  ['input', 'ColorSwatches', '色板'],
  ['input', 'DateField', '日期'],
  ['input', 'TimeField', '时间'],
  ['input', 'DateTimeField', '日期时间'],
  ['input', 'DateTimeRangeField', '日期时间区间'],
  ['input', 'DateRangeField', '日期区间'],
  ['input', 'ShortcutField', '快捷键录制'],
  // selection
  ['selection', 'Checkbox', '复选'],
  ['selection', 'CheckboxGroup', '复选组'],
  ['selection', 'RadioGroup', '单选组'],
  ['selection', 'Switch', '开关'],
  ['selection', 'Select', '下拉选择'],
  ['selection', 'Segmented', '分段选择'],
  ['selection', 'ToggleGroup', '多段切换'],
  ['selection', 'ImageChoice', '图片选择'],
  ['selection', 'TreeSelect', '树形选择'],
  // form
  ['form', 'Field', '字段框（标签/校验/描述）'],
  ['form', 'Form', '表单控制器'],
  ['form', 'FormField', '表单字段'],
  ['form', 'FormGroup', '表单分组'],
  ['form', 'FormFooter', '表单动作栏'],
  ['form', 'useFormController', '表单状态 hook'],
  // overlay
  ['overlay', 'Dialog', '模态对话框'],
  ['overlay', 'Drawer', '抽屉'],
  ['overlay', 'Sheet', '底部动作面板'],
  ['overlay', 'Popover', '弹出层'],
  ['overlay', 'Tooltip', '文字气泡'],
  ['overlay', 'Menu', '下拉菜单'],
  ['overlay', 'ContextMenu', '右键上下文菜单'],
  ['overlay', 'ConfirmAction', '危险二次确认'],
  ['overlay', 'CommandPalette', '命令面板'],
  ['overlay', 'FloatingPanel', '浮动面板'],
  // feedback
  ['feedback', 'Alert', '提示条'],
  ['feedback', 'Empty', '空状态'],
  ['feedback', 'Result', '结果页'],
  ['feedback', 'Spin', '加载包裹'],
  ['feedback', 'Progress', '进度'],
  ['feedback', 'Skeleton', '骨架屏'],
  ['feedback', 'Tag', '状态标签'],
  ['feedback', 'Badge', '计数与提示徽标'],
  ['feedback', 'ToastHost', '轻提示宿主'],
  ['feedback', 'createToastChannel', '轻提示通道'],
  ['feedback', 'FeedbackHost', '全局反馈宿主'],
  ['feedback', 'createFeedbackChannel', '反馈通道'],
  // data
  ['data', 'List', '列表'],
  ['data', 'ListItem', '列表行'],
  ['data', 'ListItemMeta', '列表行元信息'],
  ['content', 'ListSection', '扁平设置分区（quiet 标题）'],
  ['content', 'ListRow', '扁平设置行（标题/描述/控件槽）'],
  ['data', 'DataTable', '数据表'],
  ['data', 'VirtualList', '虚拟列表'],
  ['data', 'Pagination', '分页'],
  ['data', 'Descriptions', '描述列表'],
  ['data', 'Statistic', '统计数值'],
  // navigation
  ['navigation', 'Tabs', '标签页'],
  ['navigation', 'Accordion', '折叠组'],
  ['navigation', 'Collapsible', '折叠'],
  ['navigation', 'Breadcrumb', '面包屑'],
  ['navigation', 'Steps', '步骤条'],
  ['navigation', 'SideNav', '侧边导航'],
  ['navigation', 'Tree', '树形导航'],
  ['navigation', 'SectionNav', '区块导航'],
  ['navigation', 'PageHeader', '页头'],
  ['navigation', 'NavigationToggle', '导航开合'],
  // layout
  ['layout', 'Flex', '弹性布局'],
  ['layout', 'Center', '居中布局'],
  ['layout', 'Grid', '网格'],
  ['layout', 'Block', '块容器'],
  ['layout', 'Card', '内容卡片'],
  ['layout', 'Divider', '分隔线'],
  ['layout', 'ScrollArea', '滚动区'],
  ['layout', 'Layout', '应用布局'],
  ['layout', 'Header', '头部容器'],
  ['layout', 'ResizablePanel', '可缩放面板'],
  ['layout', 'OverflowToolbar', '溢出工具条'],
  ['layout', 'OverflowHint', '溢出渐隐'],
  ['layout', 'SurfaceFade', '表面渐隐'],
  // content
  ['content', 'Text', '文字'],
  ['content', 'Paragraph', '段落'],
  ['content', 'Heading', '标题层级'],
  ['content', 'HighlightText', '命中高亮'],
  ['content', 'SecretValue', '密钥显隐'],
  ['content', 'ShortcutHint', '快捷键提示'],
  // identity & media
  ['identity', 'Icon', '语义图标'],
  ['identity', 'BrandMark', '品牌标'],
  ['identity', 'Avatar', '头像'],
  ['identity', 'AvatarGroup', '头像组'],
  ['identity', 'IdentityCard', '快捷身份名片'],
  ['identity', 'IdentityTrigger', '身份名片触发器'],
  ['identity', 'FollowButton', '受控关注动作'],
  ['identity', 'ImageGrid', '多图网格'],
  ['identity', 'Lightbox', '多图灯箱（网格宿主）'],
  ['identity', 'MomentCard', '动态卡片'],
  ['identity', 'MomentCommentRow', '动态评论行'],
  ['identity', 'MomentCommentComposer', '动态评论输入'],
  ['identity', 'MomentScopeBar', '动态范围与搜索'],
  ['identity', 'MomentComposerSurface', '动态发布器'],
  ['identity', 'MomentAudiencePicker', '动态受众选择'],
  ['identity', 'MomentCircleCard', '圈友分组卡'],
  ['identity', 'MomentCircleEditor', '圈友草稿编辑'],
  ['identity', 'MomentAuthor', '作者名片触发（动态宿主）'],
  ['identity', 'MomentTrustMeta', '来源与受众（动态宿主）'],
  ['identity', 'MomentReactionBar', '动态互动'],
  ['identity', 'UserProfileHeader', '个人头部'],
  ['identity', 'StatGrid', '动态统计'],
  ['identity', 'FeedSortFloat', '滚动排序浮层'],
  ['identity', 'AgentAvatar', 'Agent 身份'],
  ['identity', 'GroupAvatar', '协作组头像'],
  ['identity', 'EmojiArtwork', '表情艺术字'],
  ['identity', 'FileTypeGlyph', '文件类型标'],
  ['identity', 'Image', '图片（失败回退）'],
  ['identity', 'ImageViewer', '图片查看器'],
  ['identity', 'HtmlPreview', 'HTML 预览'],
  ['identity', 'QrCode', '二维码'],
  ['identity', 'VideoPlayer', '视频'],
  ['identity', 'AudioPlayer', '音频'],
  ['identity', 'Carousel', '轮播'],
  // code
  ['code', 'CodeBlock', '代码块'],
  ['code', 'CodeSnippet', '行内/小段代码片'],
  ['code', 'CodeEditor', '代码编辑器'],
  ['code', 'CodeDiff', '差异对比'],
  ['code', 'DiagramPreview', '图表预览'],
  ['code', 'Markdown', 'Markdown 渲染'],
  // advanced
  ['advanced', 'Autocomplete', '自动补全'],
  ['advanced', 'CommandPicker', '命令选择器'],
  ['advanced', 'SlashCommandMenu', '斜杠命令'],
  ['advanced', 'MentionPicker', '提及选择'],
  ['advanced', 'EmojiPicker', '表情选择'],
  ['advanced', 'FilePicker', '文件选择'],
  ['advanced', 'FileDropzone', '文件拖放'],
  ['advanced', 'ReorderableList', '可排序列表'],
  ['advanced', 'RichTextEditor', '富文本编辑器'],
  ['advanced', 'CalendarView', '日历'],
  ['advanced', 'GuideStep', '引导步骤'],
  ['advanced', 'ResizableNavigationRail', '可缩放导航轨'],
  // runtime — mostly behaviour-only primitives; the board explains them
  // through their contract rather than faking a standalone visual control.
  ['runtime', 'UIProvider', '主题令牌提供者（应用根）'],
  ['runtime', 'useUITokens', '令牌读取 hook'],
  ['runtime', 'FocusBoundary', '焦点圈定与还原'],
  ['runtime', 'RenderSuspension', '隐藏时保留视图状态（Activity）'],
  ['runtime', 'MotionPolicy', '动效偏好提供者'],
  ['runtime', 'useMotionPolicy', '动效偏好 hook'],
  ['runtime', 'FontAssets', '授权字体资产加载'],
  ['runtime', 'ViewErrorBoundary', '局部视图错误边界'],
];

/** Vetted: has a reviewed specimen AND is consumed by a prototype surface. */
const VETTED_CONSUMERS: Record<string, string[]> = {
  Button: [CHAT, MOMENTS, SETTINGS],
  IconButton: [CHAT, MOMENTS, SETTINGS],
  TextField: [MOMENTS, SETTINGS],
  TextArea: [CHAT, MOMENTS, SETTINGS],
  Checkbox: [CHAT],
  Switch: [CHAT, SETTINGS],
  Select: [MOMENTS, SETTINGS],
  Segmented: [CHAT, MOMENTS, SETTINGS],
  Toggle: [MOMENTS],
  Field: [SETTINGS],
  Dialog: [CHAT, MOMENTS, SETTINGS],
  Popover: [CHAT, MOMENTS],
  Menu: [CHAT, MOMENTS],
  Alert: [CHAT, SETTINGS],
  Empty: [CHAT, MOMENTS, SETTINGS],
  Tag: [CHAT, SETTINGS],
  Avatar: [CHAT, MOMENTS],
  AvatarGroup: [CHAT, MOMENTS],
  CopyButton: [SETTINGS],
  QrCode: [SETTINGS],
  ListSection: [SETTINGS],
  ListRow: [SETTINGS],
};

/** Registered gaps — hand-rolled in prototypes today, awaiting promotion. */
const GAPS: Array<[CategoryId, CapabilityKind, string, string, string, string?]> = [
  ['data', 'primitive', 'ActivityHeatmap', '活跃热力图（统计分区）', SETTINGS],
  ['advanced', 'primitive', 'VoiceRecorder', '语音录制与波形（富输入）', CHAT],
  ['navigation', 'composition', 'CommandSurface', '封闭域命令浮层（搜索/命令面板）', CHAT],
  ['data', 'composition', 'ConversationRow', '会话行（头像/摘要/未读/置顶/静音）', CHAT],
];

function build(): CapabilityRecord[] {
  const records: CapabilityRecord[] = IMPLEMENTED.map(([category, id, title]) => {
    const consumedBy = VETTED_CONSUMERS[id];
    return {
      id, title, category, kind: 'primitive',
      status: consumedBy ? 'vetted' : 'implemented',
      ...(consumedBy ? { consumedBy } : {}),
    };
  });
  for (const [category, kind, id, title, neededBy, note] of GAPS) {
    records.push({ id, title, category, kind, status: 'gap', neededBy, note });
  }
  return records;
}

export const CAPABILITIES: readonly CapabilityRecord[] = build();

export function byStatus(status: CapabilityStatus): CapabilityRecord[] {
  return CAPABILITIES.filter(c => c.status === status);
}

export function byCategory(category: CategoryId): CapabilityRecord[] {
  return CAPABILITIES.filter(c => c.category === category);
}

/** Components with a reviewed specimen on the 样本 board. */
export const SPECIMEN_IDS: readonly string[] = Object.keys(VETTED_CONSUMERS);

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  vetted: '已验收',
  implemented: '已实现 · 待消费',
  gap: '缺口已登记',
};
