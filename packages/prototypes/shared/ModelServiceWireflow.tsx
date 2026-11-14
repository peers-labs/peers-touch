import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, ConfigProvider, Divider, Flex, Input, Modal, Segmented, Select, Space, Switch, Tag, Typography, theme } from 'antd';
import {
  addPersonalWireService, advanceWireInstallations, beginWireLogin, changeWireGraph, disconnectWireService,
  finishWireLogin, installWireRuntime, invokeWireModel, loadWireGraph,
  publishWireModels, resetWireGraph, revokeWireActor, saveWireAPI, serviceStep,
  subscribeWireGraph, verifyWireModel, visibleModels, resolveWireService,
  type WireActor, type WireGraph, type WireService,
} from './modelServiceWireflowState';
import { createAntdTokenTheme } from './design-tokens/antd';
import CLIProfileWireEditor from './CLIProfileWireEditor';

const { Title, Text, Paragraph } = Typography;
const actors = [{ value: 'alice', label: 'Alice' }, { value: 'bob', label: 'Bob' }];
const steps = ['安装', '连接账号', '验证模型', '分配用户', '可使用'];
function useGraph() {
  const [graph, setGraph] = useState(loadWireGraph);
  useEffect(() => subscribeWireGraph(() => setGraph(loadWireGraph())), []);
  return graph;
}
export function wireflowURL(site: 'desktop' | 'dashboard', actor: WireActor = 'alice', surface = 'settings') {
  const url = new URL(window.location.href);
  url.searchParams.set('site', site);
  url.searchParams.set('wireflow', 'model-service');
  url.searchParams.set('actor', actor);
  url.searchParams.set('surface', surface);
  url.searchParams.delete('state');
  return `${url.pathname}${url.search}`;
}
function ReviewBar({ actor, consumer = false }: { actor: WireActor; consumer?: boolean }) {
  return <Flex gap="small" wrap align="center" style={{ marginBottom: 16 }}>
    <Tag>Draft · 交互线框</Tag>
    <Text type="secondary">账号授权、目录与调用均为模拟，不输入真实密钥。</Text>
    {consumer && <Select virtual={false} aria-label="模拟消费账号" value={actor} options={actors}
      onChange={(value) => window.location.assign(wireflowURL('desktop', value as WireActor))} />}
    <Button type="text" onClick={resetWireGraph}>重置演示</Button>
  </Flex>;
}
function ConnectionEditor({ item, graph, onManageSource }: { item: WireService; graph: WireGraph; onManageSource?: (id: string) => void }) {
  const [authPage, setAuthPage] = useState(false);
  const [credential, setCredential] = useState('');
  const [endpoint, setEndpoint] = useState('https://api.example.com/v1');
  const [modelId, setModelId] = useState(item.models[0]?.id ?? 'default');
  const [recipients, setRecipients] = useState<WireActor[]>(['alice']);
  const [probeFailure, setProbeFailure] = useState(false);
  const step = serviceStep(graph, item);
  useEffect(() => {
    if (item.attempt !== 'waiting' || item.deadline === null) return;
    const timer = window.setTimeout(() => finishWireLogin(item.id, 'expired'), Math.max(0, item.deadline - Date.now()));
    return () => window.clearTimeout(timer);
  }, [item.id, item.attempt, item.deadline]);
  const models = item.models.map((entry) => ({ value: entry.id, label: entry.label }));
  const selected = item.models.find((entry) => entry.id === modelId) ?? item.models[0];
  const connected = item.connection === 'connected';
  const verified = Boolean(selected?.verifiedAt);
  const next = step === 0 ? '等待安装' : step === 1 ? '连接账号'
    : step === 2 ? '验证调用' : step === 3 ? '分配模型' : '已完成接入';
  return <section aria-label={`${item.label} 服务详情`} data-journey-step={step}>
    <Title level={4}>{item.label}</Title>
    <Paragraph type="secondary">
      {item.owner === 'station' ? `Station 共享账号 · ${item.kind === 'cli' ? 'CLI 在 Station 执行' : 'API 服务'}` : '仅本人使用'}
    </Paragraph>
    <Flex wrap gap="small" role="list" aria-label="接入进度">
      {steps.map((title, index) => <span role="listitem" key={title} aria-current={index === step ? 'step' : undefined}>
        <Tag color={index === step ? 'processing' : undefined} style={{ whiteSpace: 'nowrap' }}>
          {index < step ? '✓' : index + 1} · {item.owner !== 'station' && index === 0 ? '服务准备'
            : item.kind === 'api' && index === 0 ? '无需安装'
            : item.owner !== 'station' && index === 3 ? '仅本人可用' : title}
        </Tag>
      </span>)}
    </Flex>
    <div style={{ paddingTop: 16, paddingBottom: 16 }} data-wireflow-stage>
      <Text strong>下一步：{next}</Text>
      {step === 0 && <>
        <Paragraph>{item.owner === 'station' ? '在上方下拉框选择此 CLI 即自动安装；进度显示在选项背景中，完成后继续连接账号。'
          : '服务尚未准备好，请管理员先准备此服务，再连接你的账号。'}</Paragraph>
      </>}
      {item.backendId && <Paragraph>
        已引用模型连接；账号配置由来源统一管理。
        <Button type="link" onClick={() => onManageSource?.(item.backendId!)}>管理连接</Button>
      </Paragraph>}
      {step === 1 && !item.backendId && <>
        <Paragraph>
          {item.kind === 'cli' ? item.owner === 'station' ? '已安装。还需要连接供应商账号，才能验证和分配模型。'
            : '连接你的供应商账号，完成验证后即可使用。'
            : item.connection === 'stored' ? '配置已保存。检查连接后才能使用模型。' : '保存 API 地址与凭据，然后检查连接。'}
        </Paragraph>
        {item.kind === 'api' && item.connection !== 'stored' ? <Flex vertical gap="small">
          <label>API 地址<Input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></label>
          <label>演示密钥<Input.Password autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)}
            placeholder="任意演示值；不会保存此输入" /></label>
          <div><Button type="primary" disabled={!credential.trim() || !endpoint.trim() || graph.offline}
            onClick={() => { saveWireAPI(item.id); setCredential(''); }}>保存配置</Button></div>
        </Flex> : item.connection === 'stored' ? <Button type="primary" disabled={graph.offline}
          onClick={() => finishWireLogin(item.id, 'success')}>检查连接</Button>
          : item.attempt === 'waiting' ? <Flex vertical gap="small">
            <Text role="status">等待供应商授权，任务有效期 90 秒。离开再返回可继续。</Text>
            <Text>设备码：DEMO-ONLY · 此码不用于真实登录。</Text>
            <Space wrap>
              <Button type="primary" onClick={() => setAuthPage(true)}>打开授权页面（模拟）</Button>
              <Button onClick={() => finishWireLogin(item.id, 'cancelled')}>取消本次登录</Button>
            </Space>
          </Flex> : <Button type="primary" disabled={graph.offline}
            onClick={() => { beginWireLogin(item.id); setAuthPage(true); }}>登录 {item.label}</Button>}
      </>}
      {step >= 2 && <>
        <Paragraph>账号已连接。{item.backendId ? '模型来自所选连接。' : item.kind === 'cli' ? '使用账号默认模型，实际型号由服务商决定。' : '以下为模拟厂商目录。'}</Paragraph>
        <label>验证的模型
          <Select virtual={false} aria-label="验证的模型" value={selected?.id} options={models} onChange={setModelId}
            style={{ width: '100%', marginTop: 8, marginBottom: 16 }} />
        </label>
        <Space wrap>
          <Button type={step === 2 ? 'primary' : 'default'} disabled={!selected || graph.offline}
            onClick={() => selected && verifyWireModel(item.id, selected.id, !probeFailure)}>
            {verified ? '重新验证调用' : '验证调用'}
          </Button>
          <Text type="secondary">生产验证可能产生厂商用量。</Text>
        </Space>
        <div style={{ minHeight: 48, paddingTop: 12 }} role="status">
          {verified ? <Text>该模型本次验证成功 · {new Date(selected!.verifiedAt!).toLocaleTimeString()}</Text>
            : <Text type="secondary">未验证的模型不会发布为可用。</Text>}
        </div>
        {item.owner === 'station' && verified && <>
          <label>分配给
            <Select virtual={false} mode="multiple" aria-label="分配给" value={recipients} options={actors}
              onChange={(values) => setRecipients(values as WireActor[])}
              style={{ width: '100%', marginTop: 8, marginBottom: 16 }} />
          </label>
          <Button type={step === 3 ? 'primary' : 'default'} disabled={!recipients.length || graph.offline}
            onClick={() => publishWireModels(item.id, recipients, [selected!.id])}>分配模型</Button>
        </>}
        {step === 4 && <div style={{ paddingTop: 16 }}>
          <Text strong>接入已完成。现在到 Desktop 使用已授权模型。</Text>
          <div><Button href={wireflowURL('desktop', item.owner === 'bob' ? 'bob' : 'alice')}>查看我的模型</Button></div>
        </div>}
      </>}
    </div>
    <div role={item.issue ? 'alert' : 'status'} style={{ minHeight: 64 }}>
      {item.issue && <Alert type="warning" title={item.issue} showIcon />}
    </div>
    {connected && !item.backendId && <Space wrap>
      <Button onClick={() => { beginWireLogin(item.id); setAuthPage(true); }}>重新连接</Button>
      <Button danger onClick={() => Modal.confirm({
        title: `断开 ${item.label}？`, content: '后续依赖此连接的调用将不可用；已有对话保留。',
        okText: '断开连接', cancelText: '取消', onOk: () => disconnectWireService(item.id),
      })}>断开连接</Button>
    </Space>}
    {item.attempt === 'waiting' && connected && <Space wrap>
      <Text role="status">新登录进行中；完成前保留有效旧连接。</Text>
      <Button onClick={() => setAuthPage(true)}>打开授权页面（模拟）</Button>
      <Button onClick={() => finishWireLogin(item.id, 'cancelled')}>取消本次登录</Button>
    </Space>}
    <details style={{ marginTop: 16 }}>
      <summary>线框场景控制（不属于生产界面）</summary>
      <Space wrap style={{ paddingTop: 8 }}>
        <Checkbox checked={probeFailure} onChange={(event) => setProbeFailure(event.target.checked)}>模拟调用失败</Checkbox>
        <Button disabled={item.attempt !== 'waiting'} onClick={() => finishWireLogin(item.id, 'failed')}>模拟授权失败</Button>
        <Button disabled={item.attempt !== 'waiting'} onClick={() => finishWireLogin(item.id, 'expired')}>模拟授权过期</Button>
        <Button disabled={!connected} onClick={() => disconnectWireService(item.id, true)}>模拟账号过期</Button>
      </Space>
    </details>
    <Modal title="供应商授权页 · 模拟回传" open={authPage} onCancel={() => setAuthPage(false)}
      okText="批准模拟授权" cancelText="返回，保留等待" onOk={() => { finishWireLogin(item.id, 'success'); setAuthPage(false); }}>
      <Paragraph>仅演示浏览器授权回到原服务的关系。未请求厂商，也未完成任何真实登录。</Paragraph>
      <Paragraph>生产授权使用 adapter 返回的真实链接、设备码或回传要求；不要求用户寻找 CLI。</Paragraph>
    </Modal>
  </section>;
}
function SharedServiceSelect({ graph, onSelect, selectedId, method }: { graph: WireGraph; onSelect: (id: string) => void; selectedId: string; method: 'api' | 'cli' }) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const keepOpen = useRef(false);
  const choices = graph.services.filter((item) => item.owner === 'station' && item.kind === method && (method !== 'cli' || item.id === item.vendor));
  const selected = graph.services.find((item) => item.id === selectedId);
  return <Select aria-label="选择模型服务" value={method === 'cli' ? selected?.vendor : selectedId} open={open} virtual={false} showSearch
    optionFilterProp="label" style={{ width: 320, maxWidth: '100%' }}
    onOpenChange={(next) => { setOpen(next || keepOpen.current); keepOpen.current = false; }}
    onSelect={(id) => {
      const selected = choices.find((item) => item.id === id);
      if (!selected) return;
      onSelect(method === 'cli' ? graph.profileDefaults[id] || id : id);
      keepOpen.current = selected.kind === 'cli' && !graph.installed.includes(selected.vendor) && !graph.offline;
      if (keepOpen.current) installWireRuntime(selected.vendor);
      setOpen(keepOpen.current);
    }}
    options={choices.map((item) => ({ value: item.id, label: item.label, item }))}
    optionRender={(option) => {
      const item = option.data.item;
      const started = graph.installations[item.vendor];
      const percent = started ? Math.min(99, Math.floor((Date.now() - started) / 60)) : 0;
      const installed = graph.installed.includes(item.vendor);
      return <div data-provider-id={item.id} style={{ position: 'relative', padding: token.paddingXS }}>
        {started && <span aria-hidden style={{ position: 'absolute', inset: 0, width: `${percent}%`,
          background: token.colorPrimaryBg, borderRadius: token.borderRadiusSM }} />}
        <Flex justify="space-between" gap="small" style={{ position: 'relative' }}>
          <Text>{item.label}</Text>
          {item.kind === 'cli' && <Text type="secondary">{started ? `安装中 ${percent}%` : installed ? '已安装' : '选择即安装'}</Text>}
        </Flex>
      </div>;
    }} />;
}
export function ModelServiceAdminWireflow() {
  const graph = useGraph();
  const [selectedId, setSelectedId] = useState('codex');
  const [method, setMethod] = useState<'api' | 'cli'>('cli');
  const record = graph.services.find((entry) => entry.id === selectedId);
  const item = record && resolveWireService(graph, record);
  const { token } = theme.useToken();
  useEffect(() => {
    const timer = window.setInterval(advanceWireInstallations, 250);
    return () => window.clearInterval(timer);
  }, []);
  return <div style={{ padding: token.paddingLG }}>
    <ReviewBar actor="alice" />
    <Title level={3}>模型服务</Title>
    <Paragraph type="secondary">接入一个服务，完成连接、验证与分配，让用户直接使用模型。</Paragraph>
    <Space wrap>
      <Button href={wireflowURL('desktop')}>查看 Alice 的 Desktop</Button>
      <Button href={wireflowURL('desktop', 'bob')}>查看 Bob 的 Desktop</Button>
      <label><Switch checked={graph.personalAllowed} onChange={(value) => changeWireGraph((current) => ({ ...current, personalAllowed: value }))} /> 允许个人账号连接</label>
      <label>允许使用 AI 的用户
        <Select mode="multiple" aria-label="允许使用 AI 的用户" value={graph.aiActors} options={actors}
          style={{ minWidth: 220 }} onChange={(values) => changeWireGraph((current) => ({
            ...current, aiActors: values as WireActor[],
          }))} />
      </label>
    </Space>
    <Divider />
    {graph.offline && <Alert type="warning" title="Station 离线。已保存状态保留，恢复连接后继续。" />}
    <Flex wrap gap="small" style={{ marginBottom: token.margin }}>
        <Segmented<'api' | 'cli'> aria-label="Provider 接入方式" value={method}
          options={[{ value: 'api', label: 'DM · 直接模型' }, { value: 'cli', label: 'CLI' }]}
          onChange={(value) => {
            setMethod(value);
            const first = graph.services.find((entry) => entry.owner === 'station' && entry.kind === value);
            if (first) setSelectedId(first.id);
          }} />
        <SharedServiceSelect key={method} graph={graph} onSelect={setSelectedId} selectedId={selectedId} method={method} />
    </Flex>
      {item && <div style={{ minWidth: 0 }}>
        {item.kind === 'cli' && <CLIProfileWireEditor key={`profile:${item.id}`} item={item} graph={graph} onSelect={setSelectedId} />}
        <ConnectionEditor key={item.id} item={item} graph={graph} onManageSource={(id) => { setMethod('api'); setSelectedId(id); }} />
        <Divider />
        <Title level={5}>已分配用户</Title>
        {actors.map(({ value, label }) => <Flex key={value} gap="small" align="center" wrap style={{ minHeight: 40 }}>
          <Text>{label} · {item.grants[value as WireActor].length} 个模型</Text>
          {item.grants[value as WireActor].length > 0 && <>
            <Button href={wireflowURL('desktop', value as WireActor, 'agent')}>按 {label} 权限试用</Button>
            <Button danger onClick={() => revokeWireActor(item.id, value as WireActor)}>撤销 {label} 权限</Button>
          </>}
        </Flex>)}
        <details style={{ marginTop: token.marginLG }}>
          <summary>节点场景控制（不属于生产界面）</summary>
          <Checkbox checked={graph.offline} onChange={(event) => changeWireGraph((current) => ({ ...current, offline: event.target.checked }))}>模拟 Station 离线</Checkbox>
        </details>
      </div>}
  </div>;
}
export function ModelServiceConsumerWireflow({ onStartChat, chat = false }: { onStartChat?: () => void; chat?: boolean }) {
  const graph = useGraph();
  const actor = new URLSearchParams(window.location.search).get('actor') === 'bob' ? 'bob' : 'alice';
  const available = visibleModels(graph, actor);
  const defaultKey = graph.defaults[actor];
  const defaultValid = available.some((entry) => entry.key === defaultKey);
  const [selectedKey, setSelectedKey] = useState(defaultKey ?? '');
  const [personalOpen, setPersonalOpen] = useState(false);
  const [vendor, setVendor] = useState('codex');
  const [personalId, setPersonalId] = useState('');
  const [refreshState, setRefreshState] = useState('');
  const { token } = theme.useToken();
  const selectedPersonal = graph.services.find((entry) => entry.id === personalId);
  const personalServices = graph.services.filter((entry) => entry.owner === actor);
  const stale = graph.services.filter((entry) => entry.owner === 'station'
    && entry.grants[actor].length > 0 && entry.connection !== 'connected');
  const sendKey = selectedKey || (defaultValid ? defaultKey! : '');
  return <div style={{ padding: token.paddingLG, minHeight: '100%' }}>
    <ReviewBar actor={actor} consumer />
    <Title level={3}>{chat ? 'Agent 对话' : '我的模型'}</Title>
    <Paragraph type="secondary">{chat ? '在当前账号权限下发送消息。输入在失败或切换页面后保留。' : '选择可使用的模型。个人默认只影响新对话。'}</Paragraph>
    <div style={{ minHeight: 112 }} role="status" data-consumer-status>
      {graph.offline ? <Alert type="warning" title="Station 暂时离线。模型与输入保留，恢复后可继续。" />
        : available.length === 0 ? <Alert type="info" title={stale.length ? '共享模型暂不可用，管理员需要重新连接。'
          : '尚无可用模型，请管理员验证并分配模型。'} />
        : <Text>{actor === 'alice' ? 'Alice' : 'Bob'} 当前可使用 {available.length} 个模型。</Text>}
      {defaultKey && !defaultValid && <Paragraph type="warning">原默认模型已不可用。偏好保留，请主动选择；不会自动换模型。</Paragraph>}
      {refreshState && <Paragraph>{refreshState}</Paragraph>}
    </div>
    <label>{chat ? '本次对话模型' : '个人默认模型'}
      <Select virtual={false} aria-label={chat ? '本次对话模型' : '个人默认模型'} value={chat ? sendKey || undefined : defaultValid ? defaultKey : undefined}
        placeholder="选择可用模型" style={{ width: '100%', marginTop: 8 }} disabled={!available.length}
        options={available.map((entry) => ({ value: entry.key,
          label: `${entry.serviceLabel} · ${entry.label} · ${entry.personal ? '个人' : '管理员分配'}` }))}
        onChange={(value) => {
          setSelectedKey(value);
          if (!chat) changeWireGraph((current) => ({ ...current, defaults: { ...current.defaults, [actor]: value } }));
        }} />
    </label>
    <Space wrap style={{ marginTop: token.marginLG }}>
      {!chat && <Button type="primary" disabled={!defaultValid || graph.offline} onClick={onStartChat}>开始对话</Button>}
      <Button onClick={() => setRefreshState(graph.offline ? '刷新失败，当前内容和偏好已保留。' : '当前模型列表已更新。')}>刷新模型</Button>
      {graph.personalAllowed && !chat && <Button onClick={() => setPersonalOpen(true)}>连接我的账号</Button>}
    </Space>
    {chat && <div style={{ marginTop: token.marginLG }}>
      <label>消息<Input.TextArea aria-label="消息" rows={4} value={graph.drafts[actor]}
        onChange={(event) => changeWireGraph((current) => ({ ...current, drafts: { ...current.drafts, [actor]: event.target.value } }))} /></label>
      <Button type="primary" style={{ marginTop: token.marginSM }} disabled={!available.some((entry) => entry.key === sendKey) || graph.offline}
        onClick={() => invokeWireModel(actor, sendKey)}>发送（模拟调用）</Button>
      <div style={{ minHeight: 100, paddingTop: token.padding }} role="status">{graph.replies[actor]}</div>
    </div>}
    {!chat && personalServices.map((entry) => <Flex key={entry.id} gap="small" wrap align="center" style={{ marginTop: token.marginLG }}>
      <Text>{entry.label} · {entry.connection === 'connected' ? '已连接' : '需要连接'}</Text>
      <Button onClick={() => { setPersonalId(entry.id); setPersonalOpen(true); }}>管理我的连接</Button>
    </Flex>)}
    <Modal title="连接我的账号" open={personalOpen} width={680} footer={null} onCancel={() => { setPersonalOpen(false); setPersonalId(''); }}>
      {selectedPersonal ? <ConnectionEditor key={selectedPersonal.id} item={selectedPersonal} graph={graph} /> : <>
        <Paragraph>仅供本人使用。无需填写协议、命令或运行目录。</Paragraph>
        <label>账号服务商<Select virtual={false} aria-label="账号服务商" value={vendor} onChange={setVendor}
          options={graph.services.filter((entry) => entry.owner === 'station').map((entry) => ({ value: entry.vendor, label: entry.label }))}
          style={{ width: '100%', marginBottom: 16 }} /></label>
        <Button type="primary" onClick={() => setPersonalId(addPersonalWireService(actor, vendor))}>继续连接</Button>
      </>}
    </Modal>
  </div>;
}
export function ModelServiceWireflowTheme({ children }: { children: React.ReactNode }) {
  return <ConfigProvider getPopupContainer={(trigger) => trigger?.parentElement || document.body} theme={{ ...createAntdTokenTheme('light'), token: {
    ...createAntdTokenTheme('light').token, controlHeight: 32,
  }, components: { Button: { controlHeight: 32 } } }}>{children}</ConfigProvider>;
}
