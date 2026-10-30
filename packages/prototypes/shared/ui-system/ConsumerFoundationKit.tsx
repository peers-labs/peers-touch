/**
 * ConsumerFoundationKit — the COMPLETE set of base components actually used by
 * apps/desktop and apps/mobile, rendered as real @peers-touch/ui specimens.
 *
 * Coverage is derived from a source scan of imports from `antd` and
 * `@lobehub/ui` in apps/desktop/src and apps/mobile/src, mapped onto the
 * peers-ui equivalent. This board answers: "can one peers-ui base layer carry
 * every base component the two clients use today?"
 *
 * Every specimen uses the real component and real local state (no onClick
 * stubs). The shared condition switch drives normal / long-copy / disabled.
 * Deeper per-capability contracts (B01..B19) live in the 20-item board;
 * this board is the breadth confirmation.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  UIProvider, Heading, Text, Paragraph, Header, Segmented, Flex, Button, Icon,
  IconButton, Link, Tag, Badge, Avatar, AvatarGroup, Card, Divider,
  TextField, TextArea, PasswordField, NumberField, OTPField, Field,
  Checkbox, CheckboxGroup, RadioGroup, Switch, Select, Slider, SearchField,
  DateField, Rating, FileDropzone, Form, FormField, useFormController, Autocomplete,
  Spin, Alert, Progress, Skeleton, Empty, Result, ToastHost, createToastChannel,
  ConfirmAction, Tooltip, Popover, Menu, Dialog, Drawer,
  DataTable, List, ListItem, ListItemMeta, Descriptions, Statistic, Pagination,
  Tabs, Accordion, Breadcrumb, Steps, SideNav, Image,
  type ChoiceOption, type QueryProjection, type Tone,
} from '@peers-touch/ui';
import './consumer-foundation.css';

type Condition = 'normal' | 'long' | 'disabled';
const long = (c: Condition, short: string, extra: string) =>
  c === 'long' ? `${short} · ${extra}` : short;
// Button has no native disabled attribute: an unavailable command stays
// focusable and exposes its reason (B19), so specimens use availability.
const unavailable = (flag: boolean, reason = '禁用样本条件下此操作不可用') =>
  flag ? { kind: 'disabled' as const, reason } : undefined;

function Section({ id, index, title, sub, children }: {
  id: string; index: string; title: string; sub: string; children: ReactNode;
}) {
  return (
    <section id={`cf-${id}`} className="cf-section" data-cf-section={id}>
      <header className="cf-section-head">
        <Text className="cf-index" tone="secondary">{index}</Text>
        <div><Heading level={3}>{title}</Heading><Paragraph tone="secondary">{sub}</Paragraph></div>
      </header>
      <div className="cf-grid">{children}</div>
    </section>
  );
}
function Card2({ title, exports: api, children, wide }: { title: string; exports: string; children: ReactNode; wide?: boolean }) {
  return (
    <article className={`cf-card${wide ? ' cf-card--wide' : ''}`} data-cf-card>
      <header className="cf-card-head"><Text strong>{title}</Text><code className="cf-api">{api}</code></header>
      <div className="cf-card-body">{children}</div>
    </article>
  );
}

/* ---------------- 1. Inputs & forms ---------------- */

function InputsSection({ condition }: { condition: Condition }) {
  const disabled = condition === 'disabled';
  const [text, setText] = useState('林晚');
  const [area, setArea] = useState('周末把阳台的薄荷分了三盆。');
  const [number, setNumber] = useState<number | null>(8);
  const [choice, setChoice] = useState('warm');
  const [multi, setMulti] = useState<string[]>(['photo']);
  const [radio, setRadio] = useState('local');
  const [on, setOn] = useState(true);
  const [range, setRange] = useState(64);
  const [otp, setOtp] = useState('');
  const [date, setDate] = useState('2026-10-30');
  const [stars, setStars] = useState(4);
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);

  const controller = useFormController<{ title: string; topic: string }>({ title: '', topic: '' });
  const [committed, setCommitted] = useState('');

  const selectOptions = [
    { value: 'warm', label: '暖纸主题' },
    { value: 'glass', label: '轻透 Glass' },
    { value: 'default', label: '当前默认' },
    { value: 'night', label: '夜间', availability: { kind: 'disabled' as const, reason: '夜间主题尚未发布' } },
  ];

  return (
    <Section id="inputs" index="01" title="输入与表单" sub="desktop 24 处、mobile 16 处文本输入；Select 26 处；Checkbox/Radio/Switch/Slider 均为真实高频控件。">
      <Card2 title="文本输入" exports="TextField">
        <Field label="显示名称" description="对外可见的名字" required>
          <TextField value={text} onChange={e => setText(e.target.value)} disabled={disabled} clearable onClear={() => setText('')}
            leading={<Icon iconId="users" size={15} />} placeholder="输入名称" />
        </Field>
      </Card2>

      <Card2 title="校验错误" exports="Field + validation">
        <Field label="站点地址" validation={{ state: 'invalid', message: '需要是 https 地址' }}>
          <TextField defaultValue="station://local" aria-invalid disabled={disabled} />
        </Field>
      </Card2>

      <Card2 title="多行文本" exports="TextArea">
        <TextArea value={area} onChange={e => setArea(e.target.value)} disabled={disabled}
          characterCount maxLength={200} minimumRows={3} aria-label="动态正文" />
      </Card2>

      <Card2 title="搜索" exports="SearchField">
        <SearchField label="搜索联系人和站点" query={query} onQueryChange={setQuery}
          onSearch={q => { setSearching(true); setTimeout(() => setSearching(false), 600); }}
          pending={searching} disabled={disabled} submitLabel="搜索" placeholder="搜索" />
      </Card2>

      <Card2 title="数字 / 密码 / 验证码" exports="NumberField · PasswordField · OTPField">
        <Flex direction="column" gap="var(--pt-space-sm)">
          <Field label="成员上限"><NumberField value={number} onValueChange={setNumber} disabled={disabled} min={1} max={99} /></Field>
          <Field label="访问口令"><PasswordField defaultValue="peers-touch" disabled={disabled} /></Field>
          <OTPField label="一次性验证码" value={otp} onValueChange={setOtp} disabled={disabled} />
        </Flex>
      </Card2>

      <Card2 title="下拉选择" exports="Select">
        <Select label="主题" options={selectOptions} value={choice} searchable
          onValueChange={v => setChoice(typeof v === 'string' ? v : (v?.[0] ?? 'warm'))} disabled={disabled} />
      </Card2>

      <Card2 title="日期" exports="DateField">
        <DateField label="提醒日期" value={date} onValueChange={setDate} disabled={disabled} />
      </Card2>

      <Card2 title="复选（含半选）" exports="Checkbox · CheckboxGroup">
        <Flex direction="column" gap="var(--pt-space-xs)">
          <Checkbox label="同时通知管理员" checked disabled={disabled} onChange={() => {}} />
          <Checkbox label="部分子项已选" indeterminate checked={false} disabled={disabled} onChange={() => {}} />
          <CheckboxGroup label="允许的内容类型" options={[
            { value: 'photo', label: '照片' }, { value: 'video', label: '视频' }, { value: 'file', label: '文件' },
          ]} value={multi} onValueChange={setMulti} disabled={disabled} />
        </Flex>
      </Card2>

      <Card2 title="单选" exports="RadioGroup">
        <RadioGroup label="可见范围" value={radio} onValueChange={v => setRadio(String(v))} disabled={disabled} options={[
          { value: 'local', label: '仅本站点' }, { value: 'federated', label: '联邦可见' }, { value: 'private', label: '仅自己' },
        ]} />
      </Card2>

      <Card2 title="开关" exports="Switch">
        <Flex direction="column" gap="var(--pt-space-xs)">
          <Switch checked={on} onCheckedChange={setOn} disabled={disabled} label="自动接收跨站动态" checkedLabel="已开启" uncheckedLabel="已关闭" />
          <Switch checked={false} disabled label="高级加密（示例禁用）" />
        </Flex>
      </Card2>

      <Card2 title="滑杆" exports="Slider">
        <Slider value={range} onValueChange={setRange} label="缓存大小"
          ticks={[{ value: 0, label: '0' }, { value: 100, label: '100' }]} valueLabel={v => `${v} GB`} />
      </Card2>

      <Card2 title="评分" exports="Rating">
        <Rating value={stars} onValueChange={setStars} label="这次连接的可靠程度" readOnly={disabled} />
      </Card2>

      <Card2 title="文件拖放" exports="FileDropzone">
        <FileDropzone label="选择或拖入附件" accept="image/*,.pdf"
          onFiles={fs2 => setFiles(fs2.map(f => f.name))} onRejected={() => setFiles(['已拒绝：不符合类型策略'])}>
          <Paragraph>拖入图片或 PDF{files.length > 0 ? ` · 已选 ${files.join(', ')}` : ''}</Paragraph>
        </FileDropzone>
      </Card2>

      <Card2 title="表单校验与提交" exports="Form · FormField" wide>
        <Form controller={controller} onCommit={values => setCommitted(`${values.title} / ${values.topic}`)}>
          <Flex direction="column" gap="var(--pt-space-sm)">
            <FormField name="title" label="协作组标题" required rules={[{ required: true, message: '请填写标题' }]}>
              <TextField placeholder={long(condition, '例如：设计评审', '这是一个比较长的占位说明用于检查伸展')} />
            </FormField>
            <FormField name="topic" label="主题" rules={[{ minimum: 2, message: '至少 2 个字符' }]}>
              <TextField placeholder="主题" />
            </FormField>
            <div className="cf-form-actions">
              <Button actionId="cf.form.submit" behavior="submit" emphasis="primary" availability={unavailable(disabled, '禁用样本条件下不能提交')}>保存协作组</Button>
              {committed && <Text tone="success" role="status">已提交：{committed}</Text>}
            </div>
          </Flex>
        </Form>
      </Card2>
    </Section>
  );
}

/* ---------------- 2. Feedback & status ---------------- */

function FeedbackSection({ condition }: { condition: Condition }) {
  const channel = useMemo(() => createToastChannel(), []);
  const [progress, setProgress] = useState(62);
  const [showAlert, setShowAlert] = useState(true);
  const seq = useMemo(() => ({ n: 0 }), []);
  const notify = (tone: 'info' | 'success' | 'danger') => {
    seq.n += 1;
    channel.publish({ id: `t${seq.n}`, message: tone === 'success' ? '已保存到本站点' : tone === 'danger' ? '发送失败，草稿已保留' : '正在同步…', tone, duration: 3000 });
  };
  return (
    <Section id="feedback" index="02" title="反馈与状态" sub="Spin 41 处、Empty 36 处、message/toast 48 处、Alert 19 处、Progress 8 处（desktop+mobile 合并）。">
      <Card2 title="加载中" exports="Spin">
        <Spin label="加载动态" active={condition !== 'disabled'}>
          <Paragraph tone="secondary">被加载态包裹的内容区</Paragraph>
        </Spin>
      </Card2>

      <Card2 title="提示条" exports="Alert">
        <Flex direction="column" gap="var(--pt-space-xs)">
          {showAlert && <Alert tone="warning" title="联系人身份尚未确认"
            description="确认之前不能共享私密文档。" dismissLabel="关闭" onDismiss={() => setShowAlert(false)} />}
          <Alert tone="success" title="跨站连接已建立" description="两个站点现在可以互发动态。" />
          <Alert tone="danger" title="同步中断" description="请检查网络后重试。"
            action={<Button actionId="cf.alert.retry" emphasis="quiet" availability={unavailable(condition === 'disabled')}>重试</Button>} />
        </Flex>
      </Card2>

      <Card2 title="进度" exports="Progress">
        <Flex direction="column" gap="var(--pt-space-xs)">
          <Progress value={progress} label="上传进度" />
          <Progress value={28} tone="danger" label="失败进度示例" />
          <Button actionId="cf.progress.advance" emphasis="quiet" availability={unavailable(condition === 'disabled')}
            onActivate={() => setProgress(p => (p >= 100 ? 0 : p + 10))}>推进 10%</Button>
        </Flex>
      </Card2>

      <Card2 title="骨架屏" exports="Skeleton">
        <Skeleton lines={4} height={12} />
      </Card2>

      <Card2 title="空状态" exports="Empty">
        <Empty description={condition === 'long' ? '还没有任何跨站动态，建立第一个可信连接后会出现在这里。' : '还没有动态'}
          action={<Button actionId="cf.empty.new" emphasis="secondary" availability={unavailable(condition === 'disabled')}>写第一条</Button>} />
      </Card2>

      <Card2 title="结果页" exports="Result">
        <Result tone="success" title="已加入协作组" description="你现在可以看到该组的共享书架。"
          actions={<Button actionId="cf.result.back" emphasis="primary" availability={unavailable(condition === 'disabled')}>回到动态</Button>} />
      </Card2>

      <Card2 title="轻提示" exports="ToastHost · createToastChannel" wide>
        <Flex gap="var(--pt-space-sm)" wrap="wrap">
          <Button actionId="cf.toast.info" availability={unavailable(condition === 'disabled')} onActivate={() => notify('info')}>信息提示</Button>
          <Button actionId="cf.toast.success" availability={unavailable(condition === 'disabled')} onActivate={() => notify('success')}>成功提示</Button>
          <Button actionId="cf.toast.danger" availability={unavailable(condition === 'disabled')} onActivate={() => notify('danger')}>失败提示（保留草稿）</Button>
        </Flex>
        <ToastHost channel={channel} />
      </Card2>

      <Card2 title="危险二次确认" exports="ConfirmAction" wide>
        <ConfirmAction actionId="cf.confirm.delete" title="删除会话「项目讨论」？" confirmLabel="永久删除" cancelLabel="取消"
          onConfirm={() => notify('danger')}>
          <Button actionId="cf.confirm.delete.trigger" tone="danger" emphasis="quiet" availability={unavailable(condition === 'disabled')}
            leading={<Icon iconId="delete" size={15} />}>删除会话</Button>
        </ConfirmAction>
      </Card2>
    </Section>
  );
}

/* ---------------- 3. Overlays ---------------- */

function OverlaysSection({ condition }: { condition: Condition }) {
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [picked, setPicked] = useState('');
  return (
    <Section id="overlays" index="03" title="浮层" sub="Modal 34 处、Tooltip 19 处、Popover 8 处、Drawer 6 处、Dropdown/Menu 5 处。统一焦点陷阱、Esc、外部点击与焦点归还。">
      <Card2 title="文字气泡" exports="Tooltip">
        <Tooltip label="只有你能看到这条备注" placement="top">
          <Button actionId="cf.tooltip.target" emphasis="secondary" availability={unavailable(condition === 'disabled')}>悬停或聚焦查看</Button>
        </Tooltip>
      </Card2>

      <Card2 title="弹出层" exports="Popover">
        <Popover label="快速反应" content={
          <Flex gap="var(--pt-space-xs)" direction="column">
            <Button actionId="cf.pop.react" emphasis="quiet" onActivate={() => setPicked('👍')}>👍 赞</Button>
            <Button actionId="cf.pop.save" emphasis="quiet" onActivate={() => setPicked('⭐')}>⭐ 收藏</Button>
          </Flex>}>
          <Button actionId="cf.popover.trigger" emphasis="secondary" availability={unavailable(condition === 'disabled')}>快速反应{picked && <span> · {picked}</span>}</Button>
        </Popover>
      </Card2>

      <Card2 title="下拉菜单" exports="Menu">
        <Menu actions={[
          { id: 'cf.menu.copy', label: '复制链接', onActivate: () => setPicked('复制链接') },
          { id: 'cf.menu.share', label: '转发到…', onActivate: () => setPicked('转发') },
          { id: 'cf.menu.sep', label: '危险', kind: 'separator' },
          { id: 'cf.menu.block', label: '屏蔽该站点', tone: 'danger', onActivate: () => setPicked('屏蔽') },
        ]}>
          <Button actionId="cf.menu.trigger" emphasis="secondary" availability={unavailable(condition === 'disabled')} trailing={<Icon iconId="chevron-down" size={15} />}>更多操作</Button>
        </Menu>
        {picked && <Text tone="secondary" role="status">已选择：{picked}</Text>}
      </Card2>

      <Card2 title="模态对话框" exports="Dialog">
        <Button actionId="cf.dialog.open" emphasis="primary" availability={unavailable(condition === 'disabled')} onActivate={() => setDialog(true)}>打开对话框</Button>
        <Dialog open={dialog} title="新建站点连接" description="输入对端站点的公开地址。"
          onDismiss={() => setDialog(false)}
          footer={<><Button actionId="cf.dialog.cancel" onActivate={() => setDialog(false)}>取消</Button>
            <Button actionId="cf.dialog.confirm" emphasis="primary" onActivate={() => setDialog(false)}>建立连接</Button></>}>
          <Field label="站点地址"><TextField defaultValue="https://" aria-label="站点地址" /></Field>
        </Dialog>
      </Card2>

      <Card2 title="抽屉" exports="Drawer">
        <Button actionId="cf.drawer.open" emphasis="secondary" availability={unavailable(condition === 'disabled')} onActivate={() => setDrawer(true)}>打开抽屉</Button>
        <Drawer open={drawer} title="会话详情" side="right" onDismiss={() => setDrawer(false)}
          footer={<Button actionId="cf.drawer.close" emphasis="primary" onActivate={() => setDrawer(false)}>完成</Button>}>
          <Paragraph>成员、共享文件与权限的详细信息。</Paragraph>
        </Drawer>
      </Card2>
    </Section>
  );
}

/* ---------------- 4. Data display ---------------- */

interface Row { id: string; name: string; station: string; unread: number }
const tableRows: Row[] = [
  { id: '1', name: '林晚', station: 'home-station', unread: 2 },
  { id: '2', name: '小区生活群', station: 'garden', unread: 12 },
  { id: '3', name: '陈屿', station: 'remote-relay', unread: 0 },
];

function DataSection({ condition }: { condition: Condition }) {
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('feed');
  const [nav, setNav] = useState('all');
  const longName = (s: string) => long(condition, s, '这是一个比较长的名称用于检查列内换行与对齐');
  return (
    <Section id="data" index="04" title="数据展示" sub="Table 8 处、List 6 处、Descriptions 3 处、Collapse 6 处、Tabs 5 处、Pagination 2 处、Statistic 1 处。">
      <Card2 title="数据表（可排序）" exports="DataTable" wide>
        <DataTable<Row> rows={tableRows} rowKey="id" pageSize={2}
          emptyLabel="没有会话"
          columns={[
            { id: 'name', label: '名称', value: (r: Row) => longName(r.name), compare: (a: Row, b: Row) => a.name.localeCompare(b.name) },
            { id: 'station', label: '站点', value: (r: Row) => r.station },
            { id: 'unread', label: '未读', value: (r: Row) => r.unread, align: 'right', compare: (a: Row, b: Row) => a.unread - b.unread },
          ]} />
      </Card2>

      <Card2 title="列表 + 元信息" exports="List · ListItem · ListItemMeta" wide>
        <List items={tableRows} itemKey={r => r.id}
          renderItem={r => <ListItem actions={<Button actionId={`cf.list.${r.id}`} emphasis="quiet" availability={unavailable(condition === 'disabled')}>查看</Button>}>
            <ListItemMeta avatar={<Text className="cf-list-avatar">{r.name.slice(0, 1)}</Text>}
              title={longName(r.name)} description={`${r.station} · ${r.unread} 条未读`} />
          </ListItem>} />
      </Card2>

      <Card2 title="描述列表" exports="Descriptions">
        <Descriptions columns={1} items={[
          { id: 'src', label: '来源', content: 'home-station' },
          { id: 'aud', label: '可见范围', content: '已确认联系人' },
          { id: 'trust', label: '身份', content: '已验证' },
        ]} />
      </Card2>

      <Card2 title="统计数值" exports="Statistic">
        <Statistic label="今日跨站动态" value={128} />
      </Card2>

      <Card2 title="分页（独立）" exports="Pagination">
        <Pagination page={page} total={84} pageSize={20} onPageChange={setPage} />
      </Card2>

      <Card2 title="标签页" exports="Tabs" wide>
        <Tabs value={tab} onValueChange={setTab} items={[
          { id: 'feed', label: '动态', content: <Paragraph>动态内容面板</Paragraph> },
          { id: 'chats', label: '对话', content: <Paragraph>对话列表面板</Paragraph> },
          { id: 'settings', label: '设置', content: <Paragraph>设置面板</Paragraph>, disabled: condition === 'disabled' },
        ]} />
      </Card2>

      <Card2 title="折叠面板" exports="Accordion">
        <Accordion defaultExpanded={['a1']} items={[
          { id: 'a1', title: '什么是可信连接？', content: <Paragraph>两个站点交换并验证身份后建立的连接。</Paragraph> },
          { id: 'a2', title: '数据保存在哪里？', content: <Paragraph>数据保存在各自站点，只建立可达性。</Paragraph> },
        ]} />
      </Card2>

      <Card2 title="面包屑" exports="Breadcrumb">
        <Breadcrumb items={[
          { id: 'home', label: '首页', href: '?site=frontend-eles&eles=consumer' },
          { id: 'settings', label: '设置' },
          { id: 'trust', label: '信任与站点' },
        ]} />
      </Card2>

      <Card2 title="步骤条" exports="Steps">
        <Steps items={[
          { id: 's1', title: '验证身份', state: 'completed' },
          { id: 's2', title: '建立连接', state: 'current' },
          { id: 's3', title: '开始同步', state: 'pending' },
        ]} />
      </Card2>

      <Card2 title="侧边导航（desktop 侧栏）" exports="SideNav">
        <SideNav style={{ minWidth: 180 }} value={nav}
          items={[
            { id: 'all', label: '全部', icon: <Icon iconId="layers" size={16} />, onActivate: () => setNav('all') },
            { id: 'people', label: '联系人', icon: <Icon iconId="users" size={16} />, onActivate: () => setNav('people') },
            { id: 'stations', label: '站点', icon: <Icon iconId="bot" size={16} />, onActivate: () => setNav('stations') },
            { id: 'disabled', label: '审计（示例禁用）', icon: <Icon iconId="settings" size={16} />, disabled: true, onActivate: () => {} },
          ]} />
      </Card2>
    </Section>
  );
}

/* ---------------- 5. Reading, identity & containers ---------------- */

const initialTags: { id: string; label: string; tone: Tone }[] = [
  { id: 'federated', label: '联邦', tone: 'info' },
  { id: 'verified', label: '已验证', tone: 'success' },
  { id: 'pending', label: '待确认', tone: 'warning' },
];

// Inline SVG data URI keeps the specimen self-contained (no network asset).
const sampleImageSource = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#e7efe9"/><circle cx="46" cy="38" r="15" fill="#6b8f7a"/><rect x="24" y="64" width="112" height="8" rx="4" fill="#9fb8a8"/><rect x="24" y="80" width="80" height="8" rx="4" fill="#c2d4c8"/></svg>',
)}`;

const stationDirectory: ChoiceOption[] = [
  { value: 'home', label: 'home-station' },
  { value: 'garden', label: 'garden 小区站' },
  { value: 'relay', label: 'remote-relay' },
  { value: 'book', label: '共享书架' },
];

function ReadingSection({ condition }: { condition: Condition }) {
  const [tags, setTags] = useState(initialTags);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState('');
  const projection = useMemo<QueryProjection<ChoiceOption>>(() => ({
    queryId: query.length,
    query,
    state: 'ready',
    items: query.trim()
      ? stationDirectory.filter(entry => entry.label.includes(query.trim()) || entry.value.includes(query.trim().toLowerCase()))
      : stationDirectory,
  }), [query]);

  return (
    <Section id="reading" index="05" title="阅读、身份与容器"
      sub="Typography 119 处、Tag 58 处、Card 15 处、Avatar 12 处、Badge 11 处、ActionIcon 23 处、Divider 7、Image 2、AutoComplete 2（desktop+mobile 合并）。">
      <Card2 title="排版" exports="Heading · Text · Paragraph · Link" wide>
        <Flex direction="column" gap="var(--pt-space-xs)">
          <Heading level={4}>林晚分享了新的书架</Heading>
          <Paragraph>正文段落承接连续社交流的阅读节奏，不把用户带进孤立的功能页。</Paragraph>
          <Text>
            默认文字 <Text strong>强调</Text> · <Text tone="secondary">次要信息</Text>
            {' · '}<Text tone="success">已确认</Text>{' · '}<Text tone="danger">已中断</Text>
          </Text>
          <Link href="#" onClick={event => event.preventDefault()}>了解可信连接如何建立</Link>
        </Flex>
      </Card2>

      <Card2 title="标签（可移除）" exports="Tag">
        <Flex direction="row" gap="var(--pt-space-xs)" wrap="wrap" align="center">
          {tags.map(tag => <Tag key={tag.id} tone={tag.tone}
            onDismiss={() => setTags(current => current.filter(item => item.id !== tag.id))}
            dismissLabel={`移除标签 ${tag.label}`}>{tag.label}</Tag>)}
          <Tag>默认</Tag><Tag tone="danger">危险</Tag>
          {tags.length < initialTags.length && <Button actionId="cf.tag.restore" emphasis="quiet"
            availability={unavailable(condition === 'disabled')}
            onActivate={() => setTags(initialTags)}>恢复标签</Button>}
        </Flex>
      </Card2>

      <Card2 title="徽标" exports="Badge">
        <Flex direction="row" gap="var(--pt-space-md)" wrap="wrap" align="center">
          <Badge count={12} label="12 条未读"><Avatar name="林晚" size={38} /></Badge>
          <Badge count={128} limit={99} label="超过 99 条未读"><Avatar name="小区群" size={38} /></Badge>
          <Badge indicator tone="danger" label="连接异常"><Avatar name="陈屿" size={38} /></Badge>
        </Flex>
      </Card2>

      <Card2 title="头像组" exports="Avatar · AvatarGroup">
        <AvatarGroup>
          <Avatar name="林晚" size={32} />
          <Avatar name="陈屿" size={32} />
          <Avatar name="小区生活群" size={32} />
          <Avatar size={32} fallback={<Text>+3</Text>} />
        </AvatarGroup>
      </Card2>

      <Card2 title="图标按钮" exports="IconButton（对应 ActionIcon 23 处）">
        <Flex direction="row" gap="var(--pt-space-xs)">
          <IconButton actionId="cf.icon.copy" iconId="copy" label="复制" availability={unavailable(condition === 'disabled')} />
          <IconButton actionId="cf.icon.refresh" iconId="refresh-cw" label="刷新" availability={unavailable(condition === 'disabled')} />
          <IconButton actionId="cf.icon.settings" iconId="settings" label="设置" availability={unavailable(condition === 'disabled')} />
          <IconButton actionId="cf.icon.delete" iconId="delete" label="删除" tone="danger" availability={unavailable(condition === 'disabled')} />
        </Flex>
      </Card2>

      <Card2 title="卡片容器" exports="Card">
        <Card heading="站点卡片" actions={<IconButton actionId="cf.card.more" iconId="settings" label="更多" emphasis="quiet"
          availability={unavailable(condition === 'disabled')} />}
          footer={<Text tone="secondary">更新于 2 分钟前</Text>}>
          <Paragraph>Card 承载连续阅读内容，抬头、动作与脚注分层，不做一整块可点击区域。</Paragraph>
        </Card>
      </Card2>

      <Card2 title="纵向布局与分隔" exports="Flex · Divider（对应 Space 13 处）">
        <Flex direction="column" gap="var(--pt-space-xs)">
          <Text>项目讨论</Text><Divider />
          <Text>共享书架</Text><Divider />
          <Text>站点设置</Text>
        </Flex>
      </Card2>

      <Card2 title="自动补全" exports="Autocomplete（对应 AutoComplete 2 处）">
        <Autocomplete label="搜索站点" placeholder="输入 home / relay"
          projection={projection} onQueryChange={setQuery} onSelect={value => setPicked(value)} />
        {picked && <Text tone="success" role="status">已选择：{stationDirectory.find(entry => entry.value === picked)?.label ?? picked}</Text>}
      </Card2>

      <Card2 title="图片（含失败回退）" exports="Image">
        <Flex direction="row" gap="var(--pt-space-md)" align="center">
          <Image resource={{ resourceId: 'sample', name: '共享图片', state: 'available', source: sampleImageSource }}
            alt="共享图片示例" style={{ width: 120, borderRadius: 8 }} />
          <Image resource={{ resourceId: 'missing', name: '缺失图片', state: 'failed', failureReason: '源不可达' }}
            fallback={<Tag tone="neutral">图片不可用</Tag>} />
        </Flex>
      </Card2>
    </Section>
  );
}

/* ---------------- shell ---------------- */

export function ConsumerFoundationKit() {
  const [condition, setCondition] = useState<Condition>('normal');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return (
    // No pt-expression-candidate here: this board renders the ACTIVE canonical
    // token theme. That opt-in class loads the draft Agent-Groups material
    // skin (--as-* vars from expression.css, status=draft); using it without
    // injecting --as-* left primary fills and avatar backgrounds unresolved.
    <UIProvider theme={theme}>
      <main className="cf-review" data-consumer-foundation data-cf-theme={theme}>
        <Header className="cf-heading">
          <div>
            <Text className="cf-overline" tone="secondary">PEERS / CONSUMER BASE LAYER</Text>
            <Heading level={2}>消费端基础组件全集</Heading>
            <Paragraph tone="secondary">来自 apps/desktop 与 apps/mobile 对 antd / @lobehub/ui 的真实使用，映射到统一 peers-ui。先总体确认覆盖是否行得通。</Paragraph>
          </div>
          <Flex direction="column" gap="var(--pt-space-sm)" className="cf-controls" align="flex-end">
            <Segmented label="主题" value={theme} onValueChange={v => setTheme(v === 'dark' ? 'dark' : 'light')} options={[
              { value: 'light', label: '浅色' }, { value: 'dark', label: '深色' },
            ]} />
            <Segmented label="样本条件" value={condition} onValueChange={v => setCondition(v as Condition)} options={[
              { value: 'normal', label: '标准' }, { value: 'long', label: '长文案' }, { value: 'disabled', label: '禁用' },
            ]} />
          </Flex>
        </Header>
        <InputsSection condition={condition} />
        <FeedbackSection condition={condition} />
        <OverlaysSection condition={condition} />
        <DataSection condition={condition} />
        <ReadingSection condition={condition} />
        <Paragraph className="cf-footer" tone="secondary">
          每个组件均为真实 peers-ui 组件与本地状态；本页确认广度与一致性。逐能力的深度合同（意图/全状态/失败恢复）在「基础组件 20」与合同套件中继续展开。产品 Journey 仍为 UNPROVEN。
        </Paragraph>
      </main>
    </UIProvider>
  );
}
