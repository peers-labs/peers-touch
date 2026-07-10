import { useState } from '@lynx-js/react';

const C = {
  primary: '#6b5bd6', primarySoft: 'rgba(110,91,214,0.1)',
  success: '#52c41a', warning: '#faad14', error: '#ff4d4f',
  text: '#262626', textSecondary: '#595959', textTertiary: '#8c8c8c', textQuaternary: '#bfbfbf',
};

const ROLE_COLOR: Record<string, string> = { GoalOwner: '#d48806', Architect: '#2f54eb', Planner: '#1677ff', Risk: '#cf1322', Supervisor: '#722ed1', Executor: '#08979c', Verifier: '#389e0d', Integrator: '#c41d7f', Historian: '#8c8c8c' };
const STANCE: Record<string, { t: string; c: string }> = { proposal: { t: '提案', c: '#1677ff' }, objection: { t: '反对', c: '#cf1322' }, counter: { t: '折中', c: '#2f54eb' }, signoff: { t: '签字', c: '#389e0d' } };

const F = 'flex' as const;

type TaskStatus = 'active' | 'archived' | 'deleted';
interface Task { id: string; project: string; title: string; status: TaskStatus; running?: boolean; branch?: string }
interface Voice { role: string; stance: string; text: string; evidenceRef?: string }
interface CtxFile { name: string; group: 'files' | 'other' }
interface TaskCtx { usedPct: number; files: CtxFile[] }
type Block =
  | { kind: 'user'; id: string; text: string; at?: string; image?: { name: string; size: string } }
  | { kind: 'agent'; id: string; text: string; bullets?: string[]; at?: string; done?: boolean }
  | { kind: 'nego'; id: string; summary: string; agentCount: number; converged: boolean; voices: Voice[]; consensus?: string }
  | { kind: 'decision'; id: string; question: string; spentSoFar?: string; options: { text: string; recommended?: boolean }[]; rollbackImpact?: string; chosen?: string }
  | { kind: 'artifact'; id: string; name: string; fileKind: string; producedBy: string }
  | { kind: 'diff'; id: string; files: number; added: number; removed: number; paths: string[] };

const MOCK = {
  tasks: [
    { id: 't-data', project: 'peers-touch', title: '接入行情 DataProvider', status: 'active' as TaskStatus, running: true, branch: 'feat/data-provider' },
    { id: 't-stock', project: 'peers-touch', title: '选股研究报告', status: 'active' as TaskStatus },
    { id: 't-social', project: 'peers-social', title: '酷炫网络实体介绍动画', status: 'active' as TaskStatus },
    { id: 't-feed', project: 'peers-social', title: '优化按钮和新帖子交互', status: 'active' as TaskStatus },
    { id: 't-brief', project: 'peers-ai-agent', title: '每日简报（每天 8:00）', status: 'active' as TaskStatus },
  ],
  selectedTaskId: 't-data',
  stream: {
    't-data': [
      { kind: 'user' as const, id: 'u1', text: '帮我给平台接入一个稳定的行情 DataProvider，统一到我们的 Provider 接口，别动上层业务。', at: '09:02' },
      { kind: 'agent' as const, id: 'a1', text: '收到。目标复述如下，确认无误就开干：', bullets: ['对比 3 家 DataProvider，按延迟/限频/文档质量打分', '选定后写适配层，统一到现有 Provider 接口', '跑冒烟+接口契约测试，不改动上层业务逻辑'], at: '09:02', done: true },
      { kind: 'nego' as const, id: 'n1', summary: '3 个 Agent 协商了选型，已收敛到 vendor-A', agentCount: 3, converged: true, voices: [{ role: 'Planner', stance: 'proposal', text: '建议 vendor-A：延迟最低、文档完整。' }, { role: 'Risk', stance: 'objection', text: '反对裸接 vendor-A：限频 50 req/s。' }, { role: 'Architect', stance: 'counter', text: '折中：选 vendor-A，加本地缓存+退避。' }], consensus: '共识：选 vendor-A + 适配层缓存退避。降级策略升级给你拍板。' },
      { kind: 'decision' as const, id: 'd1', question: 'vendor-A 限频 50 req/s，降级策略怎么定？', spentSoFar: '$1.3 / $5', options: [{ text: '缓存+指数退避（推荐）', recommended: true }, { text: '改选 vendor-B（贵但有 SLA）' }, { text: '暂停，等商务谈 SLA' }], rollbackImpact: '适配层独立分支，回退不影响上层。' },
    ],
  },
  context: { 't-data': { usedPct: 45, files: [{ name: 'src/providers/Provider.ts', group: 'files' as const }, { name: 'src/providers/vendor-a.adapter.ts', group: 'files' as const }, { name: 'bench/latency.csv', group: 'other' as const }] } },
};

function Row(props: { style?: Record<string, unknown>; children?: unknown; [k: string]: unknown }) {
  const { style, children, ...rest } = props;
  return <view lynx-computed-display={F} lynx-default-display-linear="false" {...rest} style={{ display: 'flex', flexDirection: 'row', ...style }}>{children}</view>;
}

export function AtelierAppletPage() {
  const [selected, setSelected] = useState(MOCK.selectedTaskId);
  const [mode, setMode] = useState<'work' | 'code' | 'design'>('work');
  const [negoOpen, setNegoOpen] = useState<Record<string, boolean>>({});
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  const [ctxTab, setCtxTab] = useState<'files' | 'other'>('files');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [tasks, setTasks] = useState(MOCK.tasks);
  const [inputText, setInputText] = useState('');

  const stream: Block[] = (MOCK.stream as Record<string, Block[]>)[selected] ?? [];
  const ctx = (MOCK.context as Record<string, TaskCtx>)[selected];
  const selectedTask = tasks.find((t) => t.id === selected);
  const projects = Array.from(new Set(tasks.map((t) => t.project)));

  const handleNewTask = () => {
    const id = `t-new-${Date.now()}`;
    const newTask: Task = { id, project: 'peers-touch', title: `New Task ${tasks.length + 1}`, status: 'active' };
    setTasks([...tasks, newTask]);
    setSelected(id);
  };

  return (
    <page>
      <Row style={{ height: '100%' }}>
        {/* Left Rail */}
        {leftOpen ? (
        <view style={{ width: '212px', height: '100%', backgroundColor: '#fafafa', borderRightWidth: '1px', borderRightColor: '#f0f0f0', paddingTop: '10px', paddingLeft: '8px', paddingRight: '8px' }}>
          <Row style={{ backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '2px', marginBottom: '10px' }}>
            {(['work', 'code', 'design'] as const).map((m) => (
              <view key={m} bindtap={() => setMode(m)} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: '5px', paddingBottom: '5px', borderRadius: '6px', backgroundColor: mode === m ? '#fff' : 'transparent' }}>
                <text style={{ fontSize: '12px', fontWeight: 'bold', color: mode === m ? C.primary : C.textTertiary }}>{m === 'work' ? 'Work' : m === 'code' ? '</> Code' : 'Design'}</text>
              </view>
            ))}
          </Row>
          <Row bindtap={handleNewTask} style={{ alignItems: 'center', padding: '7px 8px' }}><text style={{ fontSize: '14px', color: C.primary, marginRight: '8px' }}>＋</text><text style={{ fontSize: '13px', color: C.textSecondary }}>New task</text></Row>
          <Row style={{ alignItems: 'center', padding: '7px 8px' }}><text style={{ fontSize: '14px', color: C.textTertiary, marginRight: '8px' }}>✦</text><text style={{ fontSize: '13px', color: C.textSecondary }}>Skills</text></Row>
          <Row style={{ alignItems: 'center', padding: '7px 8px', marginBottom: '14px' }}><text style={{ fontSize: '14px', color: C.textTertiary, marginRight: '8px' }}>⏱</text><text style={{ fontSize: '13px', color: C.textSecondary }}>Automation</text></Row>
          <text style={{ fontSize: '12px', fontWeight: 'bold', color: C.textTertiary, paddingLeft: '4px', marginBottom: '6px' }}>Your Task List</text>
          <scroll-view scroll-y={true} style={{ flex: 1 }}>
            {projects.map((project) => (
              <view key={project} style={{ marginBottom: '12px' }}>
                <text style={{ fontSize: '11px', color: C.textTertiary, fontWeight: 'bold', paddingLeft: '4px', marginBottom: '4px' }}>{project}</text>
                {tasks.filter((t) => t.project === project).map((task) => (
                  <Row key={task.id} bindtap={() => setSelected(task.id)} style={{ alignItems: 'center', padding: '6px 8px', borderRadius: '6px', backgroundColor: task.id === selected ? C.primarySoft : 'transparent' }}>
                    {task.running ? <text style={{ fontSize: '8px', color: C.success, marginRight: '6px' }}>●</text> : null}
                    {task.branch ? <text style={{ fontSize: '12px', color: C.textQuaternary, marginRight: '6px' }}>⎇</text> : null}
                    <text style={{ flex: 1, fontSize: '13px', color: task.id === selected ? C.primary : C.text }}>{task.title}</text>
                  </Row>
                ))}
              </view>
            ))}
          </scroll-view>
          <view bindtap={() => setLeftOpen(false)} style={{ alignItems: 'center', paddingTop: '8px', paddingBottom: '8px', borderTopWidth: '1px', borderTopColor: '#f0f0f0' }}>
            <text style={{ fontSize: '11px', color: C.textTertiary }}>◀ Collapse</text>
          </view>
        </view>
        ) : (
        <view bindtap={() => setLeftOpen(true)} style={{ width: '36px', height: '100%', backgroundColor: '#fafafa', borderRightWidth: '1px', borderRightColor: '#f0f0f0', alignItems: 'center', paddingTop: '12px' }}>
          <text style={{ fontSize: '14px', color: C.textTertiary }}>▶</text>
          <text style={{ fontSize: '10px', color: C.textTertiary, marginTop: '8px' }}>T</text>
        </view>
        )}

        {/* Centre */}
        <view lynx-computed-display={F} style={{ flexGrow: 1, flexShrink: 1, flexBasis: '0%', height: '100%' }}>
          <Row style={{ alignItems: 'center', height: '40px', paddingLeft: '18px', paddingRight: '18px', borderBottomWidth: '1px', borderBottomColor: '#f0f0f0' }}>
            <text style={{ fontWeight: 'bold', fontSize: '13px', marginRight: '8px' }}>{selectedTask?.title ?? ''}</text>
            <text style={{ fontSize: '12px', color: C.textTertiary }}>{selectedTask?.project ?? ''}</text>
            <view style={{ flex: 1 }} />
            <Row style={{ alignItems: 'center', borderWidth: '1px', borderColor: '#f0f0f0', borderRadius: '8px', paddingLeft: '10px', paddingRight: '10px', height: '28px' }}>
              <text style={{ fontSize: '12px', color: C.textSecondary }}>Open in</text>
              <view style={{ width: '12px', height: '12px', borderRadius: '3px', backgroundColor: '#10b981', marginLeft: '6px' }} />
            </Row>
          </Row>
          <scroll-view scroll-y={true} style={{ flex: 1 }}>
            <view style={{ paddingTop: '18px', paddingLeft: '24px', paddingRight: '24px' }}>
            {stream.map((block) => {
              if (block.kind === 'user') return <view key={block.id} style={{ alignItems: 'flex-end', marginBottom: '16px' }}><view style={{ backgroundColor: '#f5f5f5', borderRadius: '12px', padding: '10px 14px', maxWidth: '75%' }}><text style={{ fontSize: '13px', lineHeight: '20px', color: C.text }}>{block.text}</text></view></view>;
              if (block.kind === 'agent') return <Row key={block.id} style={{ alignItems: 'flex-start', marginBottom: '16px' }}><view style={{ width: '24px', height: '24px', borderRadius: '12px', backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', marginRight: '8px' }}><text style={{ color: '#fff', fontSize: '11px', fontWeight: 'bold' }}>A</text></view><view style={{ flex: 1 }}><text style={{ fontSize: '13px', lineHeight: '20px', color: C.text }}>{block.text}</text>{block.bullets?.map((b, i) => <Row key={i} style={{ marginTop: '2px' }}><text style={{ fontSize: '13px', color: C.textTertiary, marginRight: '6px' }}>•</text><text style={{ flex: 1, fontSize: '13px', color: C.text }}>{b}</text></Row>)}{block.done ? <text style={{ fontSize: '12px', color: C.success, fontWeight: 'bold', marginTop: '8px' }}>● Completed</text> : null}{block.done ? <Row style={{ marginTop: '6px' }}><text style={{ fontSize: '14px', color: C.textQuaternary, marginRight: '12px' }}>👍</text><text style={{ fontSize: '14px', color: C.textQuaternary, marginRight: '12px' }}>👎</text><text style={{ fontSize: '14px', color: C.textQuaternary, marginRight: '12px' }}>📋</text><text style={{ fontSize: '14px', color: C.textQuaternary }}>🔄</text></Row> : null}</view></Row>;
              if (block.kind === 'nego') return <NegoBlock key={block.id} b={block} open={!!negoOpen[block.id]} onToggle={() => setNegoOpen({ ...negoOpen, [block.id]: !negoOpen[block.id] })} />;
              if (block.kind === 'decision') return <DecisionBlock key={block.id} b={block} />;
              if (block.kind === 'artifact') return <Row key={block.id} style={{ alignItems: 'center', marginBottom: '8px', paddingLeft: '32px' }}><text style={{ fontSize: '14px', color: C.primary, marginRight: '8px' }}>◆</text><text style={{ fontSize: '12px', color: C.text }}>{block.name}</text><text style={{ fontSize: '11px', color: C.textTertiary, marginLeft: '8px' }}>{block.fileKind}</text></Row>;
              if (block.kind === 'diff') return <view key={block.id} style={{ paddingLeft: '32px', marginBottom: '12px' }}><Row bindtap={() => setDiffOpen({ ...diffOpen, [block.id]: !diffOpen[block.id] })} style={{ alignItems: 'center', padding: '6px 10px', backgroundColor: '#fafafa', borderRadius: '6px' }}><text style={{ fontSize: '12px', color: C.textTertiary, marginRight: '6px' }}>{diffOpen[block.id] ? '⌄' : '›'}</text><text style={{ fontSize: '12px', color: C.textSecondary }}>{block.files} files</text><text style={{ fontSize: '11px', color: C.success, marginLeft: '8px' }}>+{block.added}</text><text style={{ fontSize: '11px', color: C.error, marginLeft: '4px' }}>-{block.removed}</text></Row>{diffOpen[block.id] ? <view style={{ paddingLeft: '10px', marginTop: '4px' }}>{block.paths.map((p) => <text key={p} style={{ fontSize: '12px', color: C.textSecondary, paddingTop: '3px' }}>{p}</text>)}</view> : null}</view>;
              return null;
            })}
            {stream.length === 0 ? <view style={{ alignItems: 'center', justifyContent: 'center', paddingTop: '60px' }}><text style={{ fontSize: '14px', color: C.textTertiary }}>No messages yet. Start a conversation below.</text></view> : null}
            </view>
          </scroll-view>
          <view style={{ paddingTop: '12px', paddingBottom: '12px', paddingLeft: '16px', paddingRight: '16px', borderTopWidth: '1px', borderTopColor: '#f0f0f0' }}>
            <Row style={{ alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: '12px', paddingLeft: '14px', paddingRight: '8px', paddingTop: '10px', paddingBottom: '10px' }}>
              <input style={{ flex: 1, fontSize: '14px', color: C.text }} value={inputText} placeholder="Help you write code, debug, optimize..." bindinput={(e: { detail: { value: string } }) => setInputText(e.detail.value)} />
              <view bindtap={() => { if (inputText.trim()) setInputText(''); }} style={{ width: '32px', height: '32px', borderRadius: '16px', backgroundColor: inputText.trim() ? C.primary : '#e8e8e8', alignItems: 'center', justifyContent: 'center', marginLeft: '8px' }}><text style={{ color: inputText.trim() ? '#fff' : C.textQuaternary, fontSize: '14px', fontWeight: 'bold' }}>↑</text></view>
            </Row>
            <Row style={{ alignItems: 'center', marginTop: '6px' }}><text style={{ fontSize: '12px', color: C.textTertiary }}>⌘ 斜杠命令  🖼 添加图片</text><view style={{ flex: 1 }} /><text style={{ fontSize: '12px', color: C.textSecondary }}>👥 Expert Hierarchy ▾</text></Row>
          </view>
        </view>

        {/* Right Panel */}
        {rightOpen ? (
        <view style={{ width: '226px', height: '100%', borderLeftWidth: '1px', borderLeftColor: '#f0f0f0', paddingTop: '14px', paddingLeft: '16px', paddingRight: '16px' }}>
          <Row style={{ alignItems: 'center', marginBottom: '12px' }}>
            <text style={{ flex: 1, fontWeight: 'bold', fontSize: '13px' }}>Todo</text>
            <text bindtap={() => setRightOpen(false)} style={{ fontSize: '14px', color: C.textTertiary }}>▶</text>
          </Row>
          <view style={{ height: '100px', alignItems: 'center', justifyContent: 'center', borderBottomWidth: '1px', borderBottomColor: '#f0f0f0' }}>
            <text style={{ fontSize: '13px', fontWeight: 'bold', color: C.textTertiary }}>No todos yet</text>
            <text style={{ fontSize: '12px', color: C.textQuaternary, marginTop: '4px' }}>Progress will appear here</text>
          </view>
          {ctx ? (
            <view style={{ marginTop: '24px' }}>
              <text style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '8px' }}>Context</text>
              <Row style={{ alignItems: 'center', marginBottom: '12px' }}>
                <view style={{ flex: 1, height: '4px', backgroundColor: '#f5f5f5', borderRadius: '2px' }}><view style={{ height: '4px', backgroundColor: C.primary, borderRadius: '2px', width: `${ctx.usedPct}%` }} /></view>
                <text style={{ fontSize: '12px', color: C.textTertiary, marginLeft: '8px' }}>{ctx.usedPct}%</text>
              </Row>
              <Row style={{ marginBottom: '8px' }}>
                <text bindtap={() => setCtxTab('files')} style={{ fontSize: '13px', fontWeight: 'bold', color: ctxTab === 'files' ? C.primary : C.textTertiary, marginRight: '16px' }}>Files</text>
                <text bindtap={() => setCtxTab('other')} style={{ fontSize: '13px', fontWeight: 'bold', color: ctxTab === 'other' ? C.primary : C.textTertiary }}>Other</text>
              </Row>
              {ctx.files.filter((f) => f.group === ctxTab).map((f) => (
                <Row key={f.name} style={{ alignItems: 'center', paddingTop: '5px', paddingBottom: '5px' }}>
                  <text style={{ fontSize: '13px', color: C.textQuaternary, marginRight: '8px' }}>📄</text>
                  <text style={{ flex: 1, fontSize: '13px', color: C.textSecondary }}>{f.name}</text>
                </Row>
              ))}
            </view>
          ) : null}
        </view>
        ) : (
        <view bindtap={() => setRightOpen(true)} style={{ width: '36px', height: '100%', borderLeftWidth: '1px', borderLeftColor: '#f0f0f0', alignItems: 'center', paddingTop: '12px' }}>
          <text style={{ fontSize: '14px', color: C.textTertiary }}>◀</text>
          <text style={{ fontSize: '10px', color: C.textTertiary, marginTop: '8px' }}>i</text>
        </view>
        )}
      </Row>
    </page>
  );
}

function NegoBlock({ b, open, onToggle }: { b: Extract<Block, { kind: 'nego' }>; open: boolean; onToggle: () => void }) {
  return (
    <view style={{ marginBottom: '16px', paddingLeft: '32px' }}>
      <Row bindtap={onToggle} style={{ alignItems: 'center', padding: '8px 10px', backgroundColor: '#fafafa', borderRadius: '8px' }}>
        <text style={{ fontSize: '12px', color: C.textTertiary, marginRight: '6px' }}>{open ? '⌄' : '›'}</text>
        <text style={{ flex: 1, fontSize: '12px', color: C.textSecondary }}>{b.summary}</text>
        <view style={{ backgroundColor: b.converged ? '#f6ffed' : '#fffbe6', borderRadius: '4px', paddingLeft: '6px', paddingRight: '6px', paddingTop: '2px', paddingBottom: '2px' }}><text style={{ fontSize: '10px', color: b.converged ? C.success : C.warning }}>{b.converged ? '已收敛' : '未收敛'}</text></view>
      </Row>
      {open ? (
        <view style={{ marginTop: '8px', paddingLeft: '10px' }}>
          {b.voices.map((v, i) => (
            <Row key={i} style={{ alignItems: 'flex-start', marginBottom: '6px' }}>
              <view style={{ backgroundColor: ROLE_COLOR[v.role] ?? C.textTertiary, borderRadius: '4px', paddingLeft: '5px', paddingRight: '5px', paddingTop: '1px', paddingBottom: '1px', marginRight: '6px' }}><text style={{ fontSize: '10px', color: '#fff' }}>{v.role}</text></view>
              {STANCE[v.stance] ? <view style={{ borderWidth: '1px', borderColor: STANCE[v.stance].c, borderRadius: '4px', paddingLeft: '4px', paddingRight: '4px', marginRight: '6px' }}><text style={{ fontSize: '10px', color: STANCE[v.stance].c }}>{STANCE[v.stance].t}</text></view> : null}
              <text style={{ flex: 1, fontSize: '12px', color: C.text, lineHeight: '18px' }}>{v.text}</text>
            </Row>
          ))}
          {b.consensus ? <view style={{ backgroundColor: '#f6ffed', borderRadius: '6px', padding: '6px 8px', marginTop: '4px' }}><text style={{ fontSize: '12px', color: C.success }}>{b.consensus}</text></view> : null}
        </view>
      ) : null}
    </view>
  );
}

function DecisionBlock({ b }: { b: Extract<Block, { kind: 'decision' }> }) {
  const [chosen, setChosen] = useState('');
  return (
    <view style={{ marginBottom: '16px', paddingLeft: '32px' }}>
      <view style={{ backgroundColor: '#fffbe6', borderWidth: '1px', borderColor: '#ffe58f', borderRadius: '10px', padding: '12px 14px' }}>
        {!chosen ? <text style={{ fontSize: '11px', fontWeight: 'bold', color: C.warning, marginBottom: '4px' }}>⚠ 需要你来决策</text> : null}
        <text style={{ fontSize: '13px', lineHeight: '20px', color: C.text }}>{b.question}</text>
        {b.spentSoFar ? <text style={{ fontSize: '11px', color: C.textTertiary, marginTop: '4px' }}>{b.spentSoFar}</text> : null}
        <view style={{ marginTop: '10px' }}>
          {b.options.map((opt) => (
            <Row key={opt.text} bindtap={() => { if (!chosen) setChosen(opt.text); }} style={{ alignItems: 'center', padding: '8px 10px', borderRadius: '6px', borderWidth: '1px', borderColor: chosen === opt.text ? C.success : opt.recommended ? C.primary : '#f0f0f0', backgroundColor: opt.recommended && !chosen ? C.primarySoft : '#fff', marginBottom: '6px', opacity: chosen && chosen !== opt.text ? 0.5 : 1 }}>
              <text style={{ flex: 1, fontSize: '12px', color: C.text }}>{opt.recommended ? '★ ' : ''}{opt.text}</text>
              {chosen === opt.text ? <text style={{ fontSize: '11px', color: C.success, fontWeight: 'bold' }}>✓</text> : null}
            </Row>
          ))}
        </view>
        {b.rollbackImpact ? <text style={{ fontSize: '11px', color: C.textTertiary, marginTop: '6px' }}>{b.rollbackImpact}</text> : null}
      </view>
    </view>
  );
}
