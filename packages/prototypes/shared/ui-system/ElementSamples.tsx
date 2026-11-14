/**
 * ElementSamples — 基础元素 tab 的「组件实样」。
 *
 * The registry used to list 100+ components as "implemented · awaiting
 * specimen" with no proof behind the row. This renders every RENDERABLE
 * implemented primitive as the real component (never a mock or a page-local
 * look-alike), grouped by the same registry categories, under one shared
 * condition switch (标准 / 长文案 / 禁用).
 *
 * Honesty rules:
 *  - Only components actually exported by @peers-touch/ui get a stage.
 *  - Behaviour-only primitives (useFormController, the feedback/toast
 *    channels) are shown through their real HOST composition (Form,
 *    FeedbackHost), never faked as a visual control.
 *  - A stage exercises the component's own API; it never restyles `.pt-*`.
 *
 * Implementation: STAGES maps capability id -> renderer. Stateful stages are
 * real components (hooks live on the card-mounted component, never called
 * during another component's render), selected per card by id.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Accordion, ActionGroup, AgentAvatar, Alert, AudioPlayer, Autocomplete, Avatar, AvatarGroup,
  Badge, Block, BrandMark, Breadcrumb, Button, CalendarView, CallControl, Card, Carousel, Center, Checkbox,
  CheckboxGroup, CodeBlock, CodeDiff, CodeEditor, CodeSnippet, Collapsible, ColorPicker,
  ColorSwatches, CommandPalette, CommandPicker, ConfirmAction, ContextMenu, CopyButton, DataTable,
  DateField, DateRangeField, DateTimeField, DateTimeRangeField, Descriptions, DiagramPreview,
  Dialog, Divider, DownloadButton, Drawer, EmojiArtwork, EmojiPicker, Empty, FeedbackHost, Field, FieldFrame,
  FileDropzone, FilePicker, FileTypeGlyph, Flex, FloatingPanel, Form, FormField, FormFooter,
  FormGroup, Grid, GroupAvatar, GuideStep, Heading, HighlightText, HtmlPreview, Icon, IconButton,
  Image, ImageChoice, InlineEdit, Layout, Link, List, ListItem, ListItemMeta, ListRow, ListSection,
  Markdown, MentionPicker, Menu, NavigationToggle, NumberField, OTPField, OverflowHint,
  OverflowToolbar, PageHeader, Paragraph, Pagination, PasswordField, Popover, Progress, QrCode,
  RadioGroup, Rating, ReorderableList, ResizableNavigationRail, ResizablePanel, Result,
  RichTextEditor, ScrollArea, SearchField, SecretValue, SectionNav, Segmented, Select, Sheet,
  ShortcutField, ShortcutHint, SideNav, Skeleton, SlashCommandMenu, Slider, Spin, SplitButton,
  Statistic, Steps, SurfaceFade, Switch, Tabs, Tag, Text, TextArea, TextField, TimeField, Toggle,
  ToggleGroup, Tooltip, Tree, TreeSelect, VideoPlayer, ViewErrorBoundary, VirtualList,
  createFeedbackChannel, useFormController,
} from '@peers-touch/ui';
import type { Availability, ResourceView } from '@peers-touch/ui';
import { CAPABILITIES, CATEGORIES, type CapabilityRecord } from './registry';

export type SampleCondition = 'normal' | 'long' | 'disabled';
export interface Ctx {
  condition: SampleCondition;
  long: boolean;
  disabled: boolean;
  unavailable: Availability | undefined;
  L: (short: string, extra: string) => string;
}
type Renderer = (c: Ctx) => ReactNode;
interface StageProps { id: string; c: Ctx }

/* Neutral demo scaffolding for pure layout primitives — not a .pt restyle. */
function Box({ children, tone = 'subtle' }: { children: ReactNode; tone?: 'subtle' | 'primary' }) {
  return <span style={{
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: '6px 10px', borderRadius: 8, fontSize: 12,
    background: tone === 'primary' ? 'var(--pt-primarySubtle)' : 'var(--pt-subtle)',
    color: 'var(--pt-text)', border: '1px solid var(--pt-border)',
  }}>{children}</span>;
}

/* ── action ───────────────────────────────────────────────────────────── */
function SplitButtonStage({ c }: { c: Ctx }) {
  return <SplitButton actionId="el.split" label={c.L('发送到生活圈', '这是一个检验主操作宽度的较长默认动作文案')}
    onActivate={() => undefined} alternativesLabel="更多发送方式" availability={c.unavailable}
    alternatives={[
      { id: 'el.split.later', label: '稍后发送', onActivate() {} },
      { id: 'el.split.draft', label: '存为草稿', onActivate() {} },
      { id: 'el.split.discard', label: '放弃编辑', tone: 'danger', onActivate() {} },
    ]} />;
}
function ToggleStage({ c }: { c: Ctx }) {
  const [toggle, setToggle] = useState(false);
  return <Toggle actionId="el.toggle" selected={toggle} onSelectedChange={setToggle}
    availability={c.unavailable}>{toggle ? '已关注' : '关注'}</Toggle>;
}
const ACTION: Record<string, Renderer> = {
  Button: c => <>
    <Button actionId="el.primary" emphasis="primary" availability={c.unavailable}>{c.L('保存改动', '这是一段用于检验伸展与折行的较长主操作文案')}</Button>
    <Button actionId="el.secondary" availability={c.unavailable}>次操作</Button>
    <Button actionId="el.quiet" emphasis="quiet" tone="danger" availability={c.unavailable}>删除</Button></>,
  IconButton: c => <>
    <IconButton actionId="el.i.search" iconId="search" label="搜索" />
    <IconButton actionId="el.i.plus" iconId="plus" label="新建" />
    <IconButton actionId="el.i.delete" iconId="delete" label="删除" tone="danger" availability={c.unavailable} /></>,
  Link: c => <>
    <Link href="#" onClick={e => e.preventDefault()}>{c.L('查看连接详情', '阅读完整的联邦站点身份与权限说明')}</Link>
    <DownloadButton source="data:text/plain,ptid" filename="ptid.txt" label="下载身份文件" /></>,
  Toggle: c => <ToggleStage c={c} />,
  CopyButton: c => <CopyButton actionId="el.copy" text="ptid:linwan:3f9a"
    label={c.L('复制 PTID', '复制这串较长的联邦身份标识')} copiedLabel="已复制" availability={c.unavailable} />,
  ActionGroup: c => <ActionGroup label="行内动作">
    <Button actionId="el.ag.a" emphasis="quiet" availability={c.unavailable}>转移</Button>
    <Button actionId="el.ag.b" emphasis="quiet" tone="danger" availability={c.unavailable}>移除</Button></ActionGroup>,
  SplitButton: c => <SplitButtonStage c={c} />,
};

/* ── input ────────────────────────────────────────────────────────────── */
function InputStage({ c, id }: StageProps) {
  const [text, setText] = useState('林晚');
  const [num, setNum] = useState<number | null>(24);
  const [otp, setOtp] = useState('');
  const [pwd, setPwd] = useState('');
  const [hex, setHex] = useState('#2f6a50');
  const [rate, setRate] = useState(4);
  const [query, setQuery] = useState('');
  const [shortcut, setShortcut] = useState('Ctrl+K');
  const [composerExpanded, setComposerExpanded] = useState(false);
  switch (id) {
    case 'TextField': return <>
      <TextField value={text} onValueChange={setText} disabled={c.disabled} clearable onClear={() => setText('')}
        leading={<Icon iconId="users" size={15} />} placeholder={c.L('显示名称', '请输入在联邦目录中展示的公开显示名称')} />
      <TextField appearance="search" reveal density="comfortable" value={query} onValueChange={setQuery}
        disabled={c.disabled} aria-label="局部搜索" leading={<Icon iconId="search" size={18} />}
        placeholder={c.L('搜索联系人', '按姓名搜索已添加的联系人')} />
    </>;
    case 'TextArea': return <>
      <TextArea value={c.L('周末把薄荷分了三盆。', '长文案条件下换成一段明显更宽的多行占位，检验自适应高度与字数。')}
        onChange={() => undefined} disabled={c.disabled} characterCount maxLength={120} minimumRows={3} aria-label="动态正文" />
      <FieldFrame appearance="composer">
        <IconButton actionId="el.composer.attach" iconId="folder-open" label="添加附件" emphasis="quiet" availability={c.unavailable} />
        <TextArea value={text} onValueChange={setText} disabled={c.disabled} framing="embedded" density="comfortable"
          autoGrow minimumRows={composerExpanded ? 4 : 1} maximumRows={composerExpanded ? 10 : 4} aria-label="消息草稿" />
        <IconButton actionId="el.composer.expand" iconId={composerExpanded ? 'minimize-2' : 'maximize-2'}
          label={composerExpanded ? '收起输入' : '展开输入'} emphasis="quiet" aria-pressed={composerExpanded}
          onActivate={() => setComposerExpanded(value => !value)} />
        <IconButton actionId="el.composer.send" iconId="send" label="发送" emphasis="primary" availability={c.unavailable} />
      </FieldFrame>
    </>;
    case 'PasswordField': return <PasswordField value={pwd} onValueChange={setPwd} disabled={c.disabled} placeholder="口令" />;
    case 'NumberField': return <NumberField value={num} onValueChange={setNum} disabled={c.disabled} />;
    case 'OTPField': return <OTPField label="六位验证码" value={otp} onValueChange={setOtp} disabled={c.disabled} />;
    case 'SearchField': return <SearchField label="站内搜索" query={query} onQueryChange={setQuery} onSearch={() => undefined}
      disabled={c.disabled} placeholder={c.L('搜索设置', '更长的提示以检验提交按钮是否挤压输入框')} />;
    case 'Slider': return <Slider value={42} onValueChange={() => undefined} label="亮度" disabled={c.disabled}
      ticks={[{ value: 0, label: '暗' }, { value: 100, label: '亮' }]} />;
    case 'Rating': return <Rating value={rate} onValueChange={setRate} label="可信度" />;
    case 'InlineEdit': return <InlineEdit value={c.L('社区书架', '一个较长的可编辑名称用于检验行内编辑布局')} onCommit={() => undefined} label="分组名称" />;
    case 'ColorPicker': return <ColorPicker value={hex} onValueChange={setHex} label="主题墨色" disabled={c.disabled} />;
    case 'ColorSwatches': return <ColorSwatches value={hex} onValueChange={setHex} label="选色"
      colors={[{ value: '#2f6a50', label: '松绿' }, { value: '#8a5a32', label: '陶土' }, { value: '#2f4a6b', label: '黛蓝' }]} />;
    case 'DateField': return <DateField value="2026-11-04" onValueChange={() => undefined} label="日期" disabled={c.disabled} />;
    case 'TimeField': return <TimeField value="09:30" onValueChange={() => undefined} label="时间" disabled={c.disabled} />;
    case 'DateTimeField': return <DateTimeField value="2026-11-04T09:30" onValueChange={() => undefined} label="日期时间" disabled={c.disabled} />;
    case 'DateRangeField': return <DateRangeField value={['2026-11-01', '2026-11-04']} onValueChange={() => undefined} label="日期区间" />;
    case 'DateTimeRangeField': return <DateTimeRangeField value={['2026-11-04T09:00', '2026-11-04T18:00']} onValueChange={() => undefined} label="时间区间" />;
    case 'ShortcutField': return <ShortcutField value={shortcut} onValueChange={setShortcut} label="快捷键"
      conflict={shortcut === 'Ctrl+P' ? '已被占用' : undefined} />;
    default: return null;
  }
}
const INPUT_IDS = ['TextField', 'TextArea', 'PasswordField', 'NumberField', 'OTPField', 'SearchField', 'Slider',
  'Rating', 'InlineEdit', 'ColorPicker', 'ColorSwatches', 'DateField', 'TimeField', 'DateTimeField',
  'DateTimeRangeField', 'DateRangeField', 'ShortcutField'];
const INPUT: Record<string, Renderer> = Object.fromEntries(INPUT_IDS.map(id => [id, c => <InputStage c={c} id={id} />]));

/* ── selection ────────────────────────────────────────────────────────── */
function SelectionStage({ c, id }: StageProps) {
  const [checks, setChecks] = useState<string[]>(['mention']);
  const [radio, setRadio] = useState('warm');
  const [on, setOn] = useState(true);
  const [choice, setChoice] = useState('5m');
  const [seg, setSeg] = useState('all');
  const [toggles, setToggles] = useState<string[]>(['push']);
  const [image, setImage] = useState('cover-a');
  const [tree, setTree] = useState('privacy/online');
  switch (id) {
    case 'Checkbox': return <>
      <Checkbox checked={on} onCheckedChange={setOn} disabled={c.disabled} label={c.L('同时通知管理员', '跨站点广播给所有具备管理权限的设备成员')} />
      <Checkbox indeterminate checked={false} disabled label="部分子项已选" /></>;
    case 'CheckboxGroup': return <CheckboxGroup value={checks} onValueChange={v => setChecks(v as string[])}
      options={[{ value: 'mention', label: '提及' }, { value: 'invite', label: '邀请' }, { value: 'reaction', label: '回应' }]} />;
    case 'RadioGroup': return <RadioGroup value={radio} onValueChange={v => setRadio(String(v))}
      options={[{ value: 'warm', label: '暖纸' }, { value: 'pine', label: '松绿' }, { value: 'night', label: '夜航' }]} />;
    case 'Switch': return <Switch checked={on} onCheckedChange={setOn} disabled={c.disabled}
      label={c.L('消息通知', '在联邦连接与本机通道上同时开启提及提醒')} />;
    case 'Select': return <Select value={choice} onValueChange={v => setChoice(String(v))} appearance="ghost" aria-label="自动锁定"
      options={[{ value: '1m', label: '1 分钟后' }, { value: '5m', label: '5 分钟后' }, { value: 'never', label: '永不' }]} />;
    case 'Segmented': return <Segmented value={seg} onValueChange={v => setSeg(String(v))}
      options={[{ value: 'all', label: '全部' }, { value: 'circle', label: '生活圈' }, { value: 'following', label: '关注' }]} />;
    case 'ToggleGroup': return <ToggleGroup label="投递方式" value={toggles} onValueChange={setToggles}
      options={[{ value: 'push', label: '推送' }, { value: 'sound', label: '提示音' }, { value: 'email', label: '邮件' }]} />;
    case 'ImageChoice': return <ImageChoice value={image} onValueChange={setImage} label="封面版式"
      items={[{ id: 'cover-a', label: '松绿', artwork: <Avatar name="松" size={32} background="#2f6a50" /> },
        { id: 'cover-b', label: '墨黑', artwork: <Avatar name="墨" size={32} background="#3d434a" /> }]} />;
    case 'TreeSelect': return <TreeSelect value={tree} onValueChange={setTree} label="权限项"
      nodes={[{ id: 'privacy', label: '隐私', children: [{ id: 'privacy/online', label: '在线状态' }, { id: 'privacy/receipt', label: '已读回执' }] }]} />;
    default: return null;
  }
}
const SELECTION_IDS = ['Checkbox', 'CheckboxGroup', 'RadioGroup', 'Switch', 'Select', 'Segmented', 'ToggleGroup', 'ImageChoice', 'TreeSelect'];
const SELECTION: Record<string, Renderer> = Object.fromEntries(SELECTION_IDS.map(id => [id, c => <SelectionStage c={c} id={id} />]));

/* ── form ─────────────────────────────────────────────────────────────── */
function FormStage() {
  const controller = useFormController<{ name: string }>({ name: '林晚' });
  return <Form controller={controller} onCommit={values => controller.reset(values)}>
    <FormGroup title="身份">
      <FormField name="name" label="显示名称" description="对外可见的名字" required
        rules={[{ required: true, message: '必填' }, { minimum: 2, message: '至少 2 个字符' }]}>
        <TextField placeholder="显示名称" />
      </FormField>
    </FormGroup>
    <FormFooter><Button actionId="el.form.reset" emphasis="quiet" behavior="reset" label="重置" />
      <Button actionId="el.form.submit" emphasis="primary" behavior="submit" label="保存" /></FormFooter>
  </Form>;
}
const FORM: Record<string, Renderer> = {
  Field: () => <Field label="显示名称" description="对外可见的名字" required><TextField defaultValue="林晚" /></Field>,
  Form: () => <FormStage />,
  FormField: () => <FormStage />,
  FormGroup: () => <FormStage />,
  FormFooter: () => <FormStage />,
};

/* ── overlay ──────────────────────────────────────────────────────────── */
function OverlayStage({ c, id }: StageProps) {
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [palette, setPalette] = useState(false);
  const [panel, setPanel] = useState(false);
  const commands = [{ id: 'go.settings', label: '打开设置', description: '跳转设置页' }, { id: 'go.agent', label: '新建 Agent' }];
  switch (id) {
    case 'Dialog': return <>
      <Button actionId="el.dialog" emphasis="primary" availability={c.unavailable} onActivate={() => setDialog(true)}>打开对话框</Button>
      <Dialog open={dialog} title="加入联邦" description="输入对端站公开地址。" onDismiss={() => setDialog(false)}
        footer={<><Button actionId="el.dialog.cancel" emphasis="quiet" onActivate={() => setDialog(false)}>取消</Button>
          <Button actionId="el.dialog.ok" emphasis="primary" onActivate={() => setDialog(false)}>建立连接</Button></>}>
        <TextField defaultValue="https://" aria-label="站点地址" /></Dialog></>;
    case 'Drawer': return <>
      <Button actionId="el.drawer" availability={c.unavailable} onActivate={() => setDrawer(true)}>打开抽屉</Button>
      <Drawer open={drawer} title="连接详情" onDismiss={() => setDrawer(false)}><p style={{ margin: 0 }}>抽屉内容。</p></Drawer></>;
    case 'Sheet': return <>
      <Button actionId="el.sheet" availability={c.unavailable} onActivate={() => setSheet(true)}>底部动作面板</Button>
      <Sheet open={sheet} title="选择操作" onDismiss={() => setSheet(false)}><Button actionId="el.sheet.a" emphasis="quiet" label="转发" /></Sheet></>;
    case 'Popover': return <Popover label="快速反应" content={<>
      <Button actionId="el.pop.like" emphasis="quiet" label="赞" />
      <Button actionId="el.pop.save" emphasis="quiet" label="收藏" /></>}>
      <Button actionId="el.pop.trigger" emphasis="secondary" availability={c.unavailable}>快速反应</Button></Popover>;
    case 'Tooltip': return <Tooltip label="删除后需重新配对"><Button actionId="el.tip" emphasis="quiet" tone="danger" availability={c.unavailable}>危险操作</Button></Tooltip>;
    case 'Menu': return <Menu actions={[
      { id: 'el.m.copy', label: '复制链接', onActivate() {} },
      { id: 'el.m.sep', label: '危险', kind: 'separator' },
      { id: 'el.m.block', label: '屏蔽该站点', tone: 'danger', onActivate() {} }]}>
      <Button actionId="el.m.trigger" emphasis="secondary" trailing={<Icon iconId="chevron-down" size={15} />} availability={c.unavailable}>更多操作</Button></Menu>;
    case 'ContextMenu': return <ContextMenu label="会话快捷操作" actions={[
      { id: 'el.ctx.pin', label: '置顶会话', onActivate() {} },
      { id: 'el.ctx.mute', label: '消息免打扰', onActivate() {} },
      { id: 'el.ctx.delete', label: '删除会话', tone: 'danger', onActivate() {} }]}>
      <Box>{c.L('右键此区域打开上下文菜单', '长文案条件下检验上下文触发区域与菜单的宽度关系')}</Box></ContextMenu>;
    case 'ConfirmAction': return <ConfirmAction actionId="el.confirm" title="删除连接" confirmLabel="确认删除" cancelLabel="取消"
      onConfirm={() => undefined}><Button actionId="el.confirm.trigger" tone="danger" emphasis="secondary" availability={c.unavailable}>删除连接</Button></ConfirmAction>;
    case 'CommandPalette': return <>
      <Button actionId="el.palette" emphasis="secondary" availability={c.unavailable} onActivate={() => setPalette(true)}>命令面板</Button>
      <CommandPalette open={palette} onDismiss={() => setPalette(false)} label="运行命令" commands={commands} onSelect={() => setPalette(false)} /></>;
    case 'FloatingPanel': return <>
      <Button actionId="el.panel" emphasis="secondary" availability={c.unavailable} onActivate={() => setPanel(true)}>浮动面板</Button>
      {panel && <FloatingPanel title="正在上传" position={{ x: 80, y: 120 }} onPositionChange={() => undefined} onClose={() => setPanel(false)}>
        <Text tone="secondary">可拖动的浮层。</Text></FloatingPanel>}</>;
    default: return null;
  }
}
const OVERLAY_IDS = ['Dialog', 'Drawer', 'Sheet', 'Popover', 'Tooltip', 'Menu', 'ContextMenu', 'ConfirmAction', 'CommandPalette', 'FloatingPanel'];
const OVERLAY: Record<string, Renderer> = Object.fromEntries(OVERLAY_IDS.map(id => [id, c => <OverlayStage c={c} id={id} />]));

/* ── feedback ─────────────────────────────────────────────────────────── */
function FeedbackStage({ c, id }: StageProps) {
  const channel = useMemo(() => createFeedbackChannel(), []);
  switch (id) {
    case 'Alert': return <Alert tone="warning" variant="inline"
      title={c.L('身份尚未确认', '在完成带外身份核验之前，跨站私密内容共享保持关闭')} description="确认之前不能共享私密文档。" />;
    case 'Empty': return <Empty description={c.L('还没有动态', '建立第一个可信连接后内容会出现在这里')}
      action={<Button actionId="el.empty" emphasis="secondary" availability={c.unavailable}>写第一条</Button>} />;
    case 'Result': return <Result tone="success" title="已加入生活圈" description="你和 12 位邻居现在可以互发动态。"
      actions={<Button actionId="el.result" emphasis="primary" availability={c.unavailable}>进入圈子</Button>} />;
    case 'Spin': return <Spin label="加载中"><Button actionId="el.spin.inner" emphasis="secondary" label="加载中面板" /></Spin>;
    case 'Progress': return <Progress value={62} label="同步进度" />;
    case 'Skeleton': return <Skeleton lines={3} />;
    case 'Tag': return <><Tag tone="info">联邦</Tag><Tag tone="success">已验证</Tag><Tag tone="warning">待确认</Tag>
      <Tag onDismiss={() => undefined} dismissLabel="移除">可移除</Tag></>;
    case 'Badge': return <>
      <Badge count={7}><IconButton actionId="el.bell" iconId="bell" label="通知" /></Badge>
      <Badge indicator tone="success" caption="在线"><Avatar name="林" size={32} /></Badge></>;
    case 'FeedbackHost':
    case 'ToastHost':
    case 'createToastChannel':
    case 'createFeedbackChannel': return <>
      <ActionGroup label="反馈演示">
        <Button actionId="el.fb.toast" emphasis="secondary" onActivate={() => channel.notify({ id: `t${Date.now()}`, message: '已保存到本机', tone: 'success' })}>轻提示</Button>
        <Button actionId="el.fb.confirm" tone="danger" emphasis="secondary"
          onActivate={() => channel.requestConfirmation({ title: '断开站点？', description: '需要重新配对。', confirmLabel: '断开', onConfirm: () => undefined })}>二次确认</Button>
      </ActionGroup><FeedbackHost channel={channel} /></>;
    default: return null;
  }
}
const FEEDBACK_IDS = ['Alert', 'Empty', 'Result', 'Spin', 'Progress', 'Skeleton', 'Tag', 'Badge',
  'ToastHost', 'createToastChannel', 'FeedbackHost', 'createFeedbackChannel'];
const FEEDBACK: Record<string, Renderer> = Object.fromEntries(FEEDBACK_IDS.map(id => [id, c => <FeedbackStage c={c} id={id} />]));

/* ── data ─────────────────────────────────────────────────────────────── */
interface DeviceRow { id: string; model: string; last: string }
const DEVICE_ROWS: DeviceRow[] = [
  { id: 'd1', model: 'MacBook Pro', last: '刚刚' },
  { id: 'd2', model: 'iPhone 16', last: '2 小时前' },
  { id: 'd3', model: '松绿书屋站', last: '昨天' },
];
function DataStage({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const listMeta = <List items={DEVICE_ROWS} itemKey={r => r.id}
    renderItem={r => <ListItemMeta avatar={<Avatar name={r.model[0]} size={32} />} title={r.model} description={`上次活跃 · ${r.last}`} />} />;
  switch (id) {
    case 'List':
    case 'ListItemMeta': return listMeta;
    case 'ListItem': return <ListItem actions={<Button actionId="el.li.remove" emphasis="quiet" tone="danger" density="compact" label="移除" />}>
      <ListItemMeta title="小区生活群" description="32 分钟前" /></ListItem>;
    case 'DataTable': return <DataTable rows={DEVICE_ROWS} rowKey="id"
      columns={[{ id: 'model', label: '设备', value: 'model' }, { id: 'last', label: '上次活跃', value: 'last' }]} />;
    case 'VirtualList': return <VirtualList height={132} rowHeight={36}
      items={Array.from({ length: 40 }, (_, i) => `联系人 ${i + 1}`)} itemKey={item => item}
      renderItem={item => <ListItem><Text>{item}</Text></ListItem>} />;
    case 'Pagination': return <Pagination page={page} total={128} pageSize={20} onPageChange={setPage} />;
    case 'Descriptions': return <Descriptions items={[
      { id: 'handle', label: '句柄', content: '@linwan@songlv.local' },
      { id: 'status', label: '状态', content: '已验证 · 在线' }]} />;
    case 'Statistic': return <Flex direction="row" gap={24}><Statistic label="今日消息" value={128} />
      <Statistic label="存储" value="3.2" suffix="GB" /></Flex>;
    default: return null;
  }
}
const DATA_IDS = ['List', 'ListItem', 'ListItemMeta', 'DataTable', 'VirtualList', 'Pagination', 'Descriptions', 'Statistic'];
const DATA: Record<string, Renderer> = Object.fromEntries(DATA_IDS.map(id => [id, () => <DataStage id={id} />]));

/* ── navigation ───────────────────────────────────────────────────────── */
function NavStage({ id }: { id: string }) {
  const [nav, setNav] = useState('general');
  const [treeNode, setTreeNode] = useState('privacy');
  switch (id) {
    case 'Tabs': return <Tabs items={[
      { id: 'a', label: '通用', content: <Text tone="secondary">通用设置面板。</Text> },
      { id: 'b', label: '网络', content: <Text tone="secondary">网络设置面板。</Text> }]} />;
    case 'Accordion': return <Accordion defaultExpanded={['q1']} items={[
      { id: 'q1', title: '什么是联邦身份？', content: <Text tone="secondary">一对本地密钥与站点句柄。</Text> },
      { id: 'q2', title: '离线时消息去哪？', content: <Text tone="secondary">暂存于对端站，上线后投递。</Text> }]} />;
    case 'Collapsible': return <Collapsible title="展开高级选项"><Text tone="secondary">高级内容。</Text></Collapsible>;
    case 'Breadcrumb': return <Breadcrumb items={[{ id: 'b1', label: '设置', href: '#' }, { id: 'b2', label: '网络' }, { id: 'b3', label: '联邦' }]} />;
    case 'Steps': return <Steps items={[
      { id: 's1', title: '核验', state: 'completed' }, { id: 's2', title: '配对', state: 'current' }, { id: 's3', title: '完成', state: 'pending' }]} />;
    case 'SideNav': return <div style={{ maxWidth: 200 }}><SideNav value={nav}
      items={[{ id: 'general', label: '通用', onActivate: () => setNav('general') }, { id: 'network', label: '网络', onActivate: () => setNav('network') }]} /></div>;
    case 'Tree': return <div style={{ maxWidth: 240 }}><Tree label="隐私设置目录" selectedId={treeNode} onSelect={setTreeNode}
      nodes={[
        { id: 'privacy', label: '隐私', children: [
          { id: 'privacy/online', label: '在线状态' },
          { id: 'privacy/receipt', label: '已读回执' },
          { id: 'privacy/block', label: '黑名单', disabled: true }] },
        { id: 'network', label: '网络', children: [{ id: 'network/relay', label: '中继站' }] },
      ]} /></div>;
    case 'SectionNav': return <SectionNav label="页内区块" sections={[{ id: 'identity', label: '身份' }, { id: 'devices', label: '设备' }]} />;
    case 'PageHeader': return <PageHeader title="联邦站点" description="管理你连接的站点与目录。"
      actions={<Button actionId="el.ph.add" emphasis="primary" label="添加站点" />} />;
    case 'NavigationToggle': return <NavigationToggle open={nav === 'general'} onOpenChange={() => undefined} label="切换导航" />;
    default: return null;
  }
}
const NAV_IDS = ['Tabs', 'Accordion', 'Collapsible', 'Breadcrumb', 'Steps', 'SideNav', 'Tree', 'SectionNav', 'PageHeader', 'NavigationToggle'];
const NAVIGATION: Record<string, Renderer> = Object.fromEntries(NAV_IDS.map(id => [id, () => <NavStage id={id} />]));

/* ── layout ───────────────────────────────────────────────────────────── */
function LayoutStage({ id }: { id: string }) {
  const [rail, setRail] = useState(200);
  switch (id) {
    case 'Flex': return <Flex direction="row" gap={8}><Box>左</Box><Box>右</Box></Flex>;
    case 'Center': return <div style={{ width: '100%' }}><Center><Box>居中</Box></Center></div>;
    case 'Grid': return <Grid columns={3} gap={8}><Box>1</Box><Box>2</Box><Box>3</Box></Grid>;
    case 'Block': return <Block><Box>块容器</Box></Block>;
    case 'Card': return <Card heading="内容卡片" actions={<Button actionId="el.card.more" emphasis="quiet" density="compact" label="更多" />}
      footer={<Text tone="secondary">卡片脚注</Text>}><Text>卡片正文。</Text></Card>;
    case 'Divider': return <Divider />;
    case 'ScrollArea': return <ScrollArea maxHeight={84}><Flex gap={6}>{Array.from({ length: 5 }, (_, i) => <Box key={i}>滚动行 {i + 1}</Box>)}</Flex></ScrollArea>;
    case 'Layout':
    case 'Header': return <div style={{ height: 168 }}><Layout header={<Box tone="primary">头部</Box>} sidebar={<Box>侧栏</Box>}>
      <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}><Box>主区</Box></div></Layout></div>;
    case 'ResizablePanel': return <div style={{ height: 120, display: 'flex' }}>
      <ResizablePanel size={rail} onSizeChange={setRail} label="调整侧栏宽度" minimum={140} maximum={280}>
        <div style={{ padding: 8, background: 'var(--pt-subtle)', height: '100%', borderRadius: 8 }}><Text tone="secondary">{rail}px</Text></div>
      </ResizablePanel></div>;
    case 'OverflowToolbar': return <OverflowToolbar label="溢出工具条" visibleCount={2} actions={[
      { id: 'el.ot.a', label: '转发', onActivate() {} }, { id: 'el.ot.b', label: '收藏', onActivate() {} },
      { id: 'el.ot.c', label: '置顶', onActivate() {} }, { id: 'el.ot.d', label: '举报', tone: 'danger', onActivate() {} }]} />;
    case 'OverflowHint': return <OverflowHint maxHeight={72}>{Array.from({ length: 4 }, (_, i) => <p key={i} style={{ margin: '4px 0' }}>溢出渐隐行 {i + 1}</p>)}</OverflowHint>;
    case 'SurfaceFade': return <SurfaceFade><Box>表面渐隐容器</Box></SurfaceFade>;
    default: return null;
  }
}
const LAYOUT_IDS = ['Flex', 'Center', 'Grid', 'Block', 'Card', 'Divider', 'ScrollArea', 'Layout', 'Header',
  'ResizablePanel', 'OverflowToolbar', 'OverflowHint', 'SurfaceFade'];
const LAYOUT: Record<string, Renderer> = Object.fromEntries(LAYOUT_IDS.map(id => [id, () => <LayoutStage id={id} />]));

/* ── content ──────────────────────────────────────────────────────────── */
function ContentStage({ id }: { id: string }) {
  const [revealed, setRevealed] = useState(false);
  switch (id) {
    case 'Text': return <><Text strong>主文字</Text> <Text tone="secondary">次文字</Text> <Text tone="muted">弱文字</Text></>;
    case 'Paragraph': return <Paragraph tone="secondary">段落文字使用内容色阶，长行在此自动换行并保持可读行距。</Paragraph>;
    case 'Heading': return <Heading level={3}>标题层级 H3</Heading>;
    case 'HighlightText': return <HighlightText text="松绿书屋今晚开放交换" query="松绿" />;
    case 'SecretValue': return <SecretValue value="ptid:linwan:3f9a7c" label="恢复密钥" revealed={revealed} onRevealChange={setRevealed} copyAllowed />;
    case 'ShortcutHint': return <ShortcutHint keys={['Ctrl', 'K']} label="打开命令面板" />;
    case 'ListSection': return <ListSection title="谁可以看到" description="这些默认只影响新会话。">
      <ListRow label="在线状态" description="让与你聊天的人看到你在线。" control={<Switch checked aria-label="在线状态" onCheckedChange={() => undefined} />} />
      <ListRow label="自动锁定" description="无操作一段时间后自动锁定。" control={<Select appearance="ghost" aria-label="自动锁定" value="5m"
        onValueChange={() => undefined} options={[{ value: '1m', label: '1 分钟后' }, { value: '5m', label: '5 分钟后' }, { value: 'never', label: '永不' }]} />} />
    </ListSection>;
    case 'ListRow': return <ListRow label="在线状态" description="让与你聊天的人看到你在线。"
      control={<Switch checked aria-label="在线状态" onCheckedChange={() => undefined} />} />;
    default: return null;
  }
}
const CONTENT_IDS = ['Text', 'Paragraph', 'Heading', 'HighlightText', 'SecretValue', 'ShortcutHint', 'ListSection', 'ListRow'];
const CONTENT: Record<string, Renderer> = Object.fromEntries(CONTENT_IDS.map(id => [id, () => <ContentStage id={id} />]));

/* ── identity & media ─────────────────────────────────────────────────── */
/* Self-contained sample raster (no network): a labelled neutral ink block. */
const SAMPLE_IMAGE = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='140'><rect width='100%' height='100%' rx='10' fill='#1a1d20'/><text x='50%' y='55%' fill='#ffffff' font-family='sans-serif' font-size='20' text-anchor='middle'>样本图片</text></svg>");
const IDENTITY: Record<string, Renderer> = {
  Icon: () => <><Icon iconId="search" label="搜索" /><Icon iconId="bell" /><Icon iconId="lock" /><Icon iconId="settings" /></>,
  BrandMark: () => <BrandMark brandId="github" size={24} label="GitHub" />,
  /* Identity discipline: own tile carries pine, every other tile is ink. */
  Avatar: () => <><Avatar name="林晚" size={44} background="#2f6a50" /><Avatar name="陈屿" size={32} background="#3d434a" /><Avatar size={40} fallback={<Icon iconId="bot" />} /></>,
  AvatarGroup: () => <AvatarGroup><Avatar name="周禾" size={32} background="#3d434a" /><Avatar name="苏禾" size={32} background="#3d434a" /><Avatar size={32} fallback="+3" /></AvatarGroup>,
  AgentAvatar: () => <AgentAvatar name="助理" size={40} />,
  GroupAvatar: () => <GroupAvatar name="邻里群" size={44} members={[{ id: '1', name: '林' }, { id: '2', name: '陈' }, { id: '3', name: '周' }, { id: '4', name: '苏' }]} />,
  EmojiArtwork: () => <EmojiArtwork emoji="🌿" label="松绿表情" />,
  FileTypeGlyph: () => <FileTypeGlyph filename="seed-list.json" size={20} />,
  Image: () => <Image resource={{ resourceId: 'img1', name: '可放大图片', state: 'available', source: SAMPLE_IMAGE }} alt="样本图" preview previewLabel="查看图片" />,
  ImageViewer: () => <Image resource={{ resourceId: 'img2', name: '可放大图片', state: 'available', source: SAMPLE_IMAGE }} alt="样本图" preview previewLabel="查看图片" />,
  HtmlPreview: () => <HtmlPreview label="安全 HTML 预览" html="<body style='font-family:sans-serif;color:#0d100d'><b>沙箱</b> 内联预览</body>" height={120} />,
  QrCode: () => <QrCode value="peers://approve/device/4f2a" size={120} label="设备关联二维码" />,
  VideoPlayer: () => <VideoPlayer resource={{ resourceId: 'av1', name: '晚风.mp4', state: 'failed', failureReason: '源不可用' }} />,
  AudioPlayer: () => <AudioPlayer resource={{ resourceId: 'au1', name: '晚风.m4a', state: 'failed', failureReason: '源不可用' }} />,
  CallControl: () => <div style={{ display: 'flex', gap: 24, padding: 16, background: 'var(--pt-mediaStage)' }}>
    <CallControl actionId="sample.call.mic" iconId="mic-off" label="取消静音" selected />
    <CallControl actionId="sample.call.leave" iconId="phone-off" label="离开通话" tone="danger" />
  </div>,
  Carousel: () => <Carousel label="图片轮播" items={[
    { id: '1', label: '第一张', content: <Box tone="primary">第一张</Box> },
    { id: '2', label: '第二张', content: <Box>第二张</Box> }]} />,
};

/* ── code ─────────────────────────────────────────────────────────────── */
function CodeStage({ id }: { id: string }) {
  const [code, setCode] = useState('const frame = "north-star";\nframe.clipToShell();');
  switch (id) {
    case 'CodeBlock': return <CodeBlock code="const pine = 'north-star';" language="ts" label="shape.ts" />;
    case 'CodeSnippet': return <Flex direction="column" gap={8}>
      <Text tone="secondary">在终端运行 <CodeSnippet code="make desktop" language="bash" /> 启动桌面端。</Text>
      <CodeSnippet code="pnpm check" language="bash" copyLabel="复制命令" copiedLabel="已复制" />
    </Flex>;
    case 'CodeEditor': return <CodeEditor value={code} onValueChange={setCode} label="形状脚本" language="ts" rows={5} onCommit={() => undefined} />;
    case 'CodeDiff': return <CodeDiff before={'color: purple;'} after={'color: var(--pt-primary);'} beforeLabel="改前" afterLabel="改后" />;
    case 'DiagramPreview': return <DiagramPreview label="连接关系" source={'graph TD\n A[你的设备] --> B[松绿书屋站]'} />;
    case 'Markdown': return <Markdown content={'### 标题\n\n这是一段 **Markdown**，含 `行内代码` 与一个[链接](#)。'} />;
    default: return null;
  }
}
const CODE_IDS = ['CodeBlock', 'CodeSnippet', 'CodeEditor', 'CodeDiff', 'DiagramPreview', 'Markdown'];
const CODE: Record<string, Renderer> = Object.fromEntries(CODE_IDS.map(id => [id, () => <CodeStage id={id} />]));

/* ── advanced ─────────────────────────────────────────────────────────── */
function AdvancedStage({ c, id }: StageProps) {
  const [query, setQuery] = useState('');
  const projection = {
    queryId: 1, query, state: 'ready' as const,
    items: ['陈屿', '林晚', '小区生活群'].filter(n => n.includes(query)).map(n => ({ value: n, label: n })),
  };
  const [month, setMonth] = useState('2026-11');
  const [rich, setRich] = useState('<p>富文本 <strong>内容</strong></p>');
  const [order, setOrder] = useState(['第一项', '第二项', '第三项']);
  const [railSize, setRailSize] = useState(180);
  switch (id) {
    case 'Autocomplete': return <Autocomplete label="找人" projection={projection} onQueryChange={setQuery} onSelect={() => undefined} placeholder="输入名字" />;
    case 'CommandPicker': return <CommandPicker label="运行命令" onSelect={() => undefined}
      commands={[{ id: 'settings', label: '打开设置' }, { id: 'agent', label: '新建 Agent' }]} />;
    case 'SlashCommandMenu': return <SlashCommandMenu label="斜杠命令" onSelect={() => undefined}
      commands={[{ id: '/todo', label: '/todo 待办' }, { id: '/plan', label: '/plan 计划' }]} />;
    case 'MentionPicker': return <MentionPicker label="提及" onSelect={() => undefined}
      commands={[{ id: '@chen', label: '@陈屿' }, { id: '@lin', label: '@林晚' }]} />;
    case 'EmojiPicker': return <EmojiPicker label="表情" onSelect={() => undefined}
      items={[{ id: 'ok', emoji: '🌿', name: '松' }, { id: 'book', emoji: '📚', name: '书' }]} />;
    case 'FilePicker': return <FilePicker label="选择文件" onFiles={() => undefined} disabled={c.disabled} />;
    case 'FileDropzone': return <FileDropzone label="拖入文件" onFiles={() => undefined} disabled={c.disabled}>
      <Text tone="secondary">点击或拖拽文件到此</Text></FileDropzone>;
    case 'ReorderableList': return <ReorderableList items={order} itemKey={item => item} onOrderChange={setOrder} label="可排序列表"
      renderItem={item => <Text>{item}</Text>} />;
    case 'RichTextEditor': return <RichTextEditor value={rich} onValueChange={setRich} label="富文本编辑" />;
    case 'CalendarView': return <CalendarView month={month} onMonthChange={setMonth} label="日历"
      events={[{ id: 'ev1', date: '2026-11-04', label: '书架交换' }]} />;
    case 'GuideStep': return <GuideStep title="扫描二维码" description="用移动端扫描对端设备上的二维码完成关联。"
      action={<Button actionId="el.guide" emphasis="primary" label="我已扫描" />} />;
    case 'ResizableNavigationRail': return <div style={{ height: 120 }}><ResizableNavigationRail size={railSize} onSizeChange={setRailSize}
      resizeLabel="调整导航轨" minimum={140} maximum={240} value="nav"
      items={[{ id: 'nav', label: '消息', onActivate() {} }, { id: 'contacts', label: '联系人', onActivate() {} }]} /></div>;
    default: return null;
  }
}
const ADVANCED_IDS = ['Autocomplete', 'CommandPicker', 'SlashCommandMenu', 'MentionPicker', 'EmojiPicker',
  'FilePicker', 'FileDropzone', 'ReorderableList', 'RichTextEditor', 'CalendarView', 'GuideStep', 'ResizableNavigationRail'];
const ADVANCED: Record<string, Renderer> = Object.fromEntries(ADVANCED_IDS.map(id => [id, c => <AdvancedStage c={c} id={id} />]));

/* ── runtime ───────────────────────────────────────────────────────────── */
/* ViewErrorBoundary is the one runtime primitive with a visible contract:
   a crashing child stays isolated in the card and the owner-driven resetKey
   brings the subtree back. The other runtime primitives are behaviour-only. */
function CrashOnDemand({ crashed }: { crashed: boolean }) {
  if (crashed) throw new Error('样本子组件主动崩溃');
  return <Text tone="secondary">子组件正常渲染中。</Text>;
}
function RuntimeStage({ id }: { id: string }) {
  const [crashed, setCrashed] = useState(false);
  switch (id) {
    case 'ViewErrorBoundary': return <Flex direction="column" gap={10}>
      <Button actionId="el.boundary.toggle" emphasis={crashed ? 'primary' : 'secondary'} tone="danger"
        label={crashed ? '重新挂载恢复视图' : '触发子组件崩溃'} onActivate={() => setCrashed(value => !value)} />
      <ViewErrorBoundary label="局部视图崩溃，已与外壳隔离" resetKey={String(crashed)}>
        <CrashOnDemand crashed={crashed} />
      </ViewErrorBoundary>
    </Flex>;
    default: return null;
  }
}
const RUNTIME_IDS = ['ViewErrorBoundary'];
const RUNTIME: Record<string, Renderer> = Object.fromEntries(RUNTIME_IDS.map(id => [id, () => <RuntimeStage id={id} />]));

const STAGES_BY_CATEGORY: Record<string, Record<string, Renderer>> = {
  action: ACTION, input: INPUT, selection: SELECTION, form: FORM, overlay: OVERLAY,
  feedback: FEEDBACK, data: DATA, navigation: NAVIGATION, layout: LAYOUT, content: CONTENT,
  identity: IDENTITY, code: CODE, advanced: ADVANCED, runtime: RUNTIME,
};

/* Behaviour-only primitives have no standalone visual form. */
const NONVISUAL = new Set(['useFormController', 'createToastChannel', 'createFeedbackChannel',
  'UIProvider', 'useUITokens', 'FocusBoundary', 'RenderSuspension', 'MotionPolicy',
  'useMotionPolicy', 'FontAssets']);
/* Sub-parts proven only through a parent composition card. */
const ALIAS: Record<string, string> = {
  ToastHost: 'FeedbackHost', ListItemMeta: 'List', ImageViewer: 'Image', Header: 'Layout',
  DownloadButton: 'Link',
};
/* Composition-only parts that cannot render outside their host; instead of
   faking a standalone form three times, the card points to the host card
   where the real part is exercised. */
const COMPOSED_IN: Record<string, string> = {
  FormField: 'Form', FormGroup: 'Form', FormFooter: 'Form',
};
/* Stages that should fill the card width (forms, lists, media, editors). */
const WIDE = new Set<string>([
  'TextField', 'TextArea', 'PasswordField', 'NumberField', 'OTPField', 'SearchField', 'Slider',
  'Rating', 'InlineEdit', 'ColorPicker', 'ColorSwatches', 'DateField', 'TimeField', 'DateTimeField',
  'DateTimeRangeField', 'DateRangeField', 'ShortcutField', 'CheckboxGroup', 'ToggleGroup',
  'ImageChoice', 'TreeSelect', 'Form', 'FormField', 'FormGroup', 'FormFooter', 'Field', 'Alert',
  'Empty', 'Result', 'Progress', 'Skeleton', 'List', 'ListItem', 'ListItemMeta', 'DataTable',
  'VirtualList', 'Pagination', 'Descriptions', 'Statistic', 'Tabs', 'Accordion', 'Collapsible',
  'Breadcrumb', 'Steps', 'SideNav', 'SectionNav', 'PageHeader', 'Grid', 'Block', 'Card', 'Divider',
  'ScrollArea', 'Layout', 'Header', 'ResizablePanel', 'ResizableNavigationRail', 'OverflowHint',
  'SurfaceFade', 'Paragraph', 'ListSection', 'ListRow', 'Image', 'ImageViewer', 'HtmlPreview',
  'VideoPlayer', 'AudioPlayer', 'Carousel', 'CodeBlock', 'CodeEditor', 'CodeDiff', 'DiagramPreview',
  'Markdown', 'Autocomplete', 'CommandPicker', 'SlashCommandMenu', 'MentionPicker', 'EmojiPicker',
  'FileDropzone', 'ReorderableList', 'RichTextEditor', 'CalendarView', 'GuideStep',
]);

function ctxFor(condition: SampleCondition): Ctx {
  const long = condition === 'long', disabled = condition === 'disabled';
  return {
    condition, long, disabled,
    unavailable: disabled ? { kind: 'disabled', reason: '禁用样本条件下此命令不可用' } : undefined,
    L: (short, extra) => long ? `${short} · ${extra}` : short,
  };
}

function SampleCard({ record, c }: { record: CapabilityRecord; c: Ctx }) {
  const targetId = ALIAS[record.id] ?? record.id;
  const render = STAGES_BY_CATEGORY[record.category]?.[targetId];
  return (
    <article className="nb-card nb-element-card" data-element={record.id}>
      <header className="nb-card-head">
        <strong>{record.title}</strong>
        <code>{record.id}</code>
        <span className="nb-element-kind">{record.kind === 'primitive' ? '基础件' : '组合件'}</span>
        <span className="nb-status" data-status={record.status}>{record.status === 'vetted' ? '已验收' : '实样·待消费'}</span>
      </header>
      <div className="nb-card-body">
        <div className="nb-card-stage nb-element-stage-wrap" data-align="start">
          {NONVISUAL.has(record.id)
            ? <Text tone="muted" style={{ fontSize: 12 }}>行为原语（无独立形态）——在其真实宿主中生效：表单见 Form，反馈见 FeedbackHost，主题/焦点/动效/字体见应用根与视图宿主。</Text>
            : COMPOSED_IN[record.id]
              ? <Text tone="muted" style={{ fontSize: 12 }}>组合子件（不能脱离宿主）——在「{COMPOSED_IN[record.id]}」卡内随真实表单一起呈现。</Text>
              : render
                ? <div className="nb-element-stage" style={WIDE.has(targetId) ? { width: '100%' } : undefined}>{render(c)}</div>
                : <Text tone="danger">缺样本：{record.id}</Text>}
        </div>
      </div>
    </article>
  );
}

export function ElementSamples({ condition }: { condition: SampleCondition }) {
  const c = ctxFor(condition);
  return (
    <div className="nb-elements" data-condition={condition}>
      {CATEGORIES.map(cat => {
        const records = CAPABILITIES.filter(r => r.category === cat.id && r.status !== 'gap');
        if (!records.length) return null;
        return (
          <section key={cat.id} className="nb-element-group" data-element-group={cat.id}>
            <h3 className="nb-element-group-title">{cat.title}<em>{records.length} 件实样</em></h3>
            <div className="nb-grid nb-element-grid">
              {records.map(record => <SampleCard key={record.id} record={record} c={c} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}
