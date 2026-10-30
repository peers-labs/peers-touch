import { useEffect, useRef, useState } from 'react';
import { Avatar, Button, Icon, IconButton, Segmented, TextArea, TextField, expressionCandidate } from '@peers-touch/ui';
import './agent-style-study.css';

const agents = [
  { id:'review', name:'Code Review', initial:'C', mark:'</>', specialty:'正确性 · 安全 · 性能', detail:'先检查实现，再给出可执行的建议。' },
  { id:'writing', name:'Writing Assistant', initial:'W', mark:'Aa', specialty:'文档 · 结构 · 表达', detail:'整理依据，让结论清楚可读。' },
  { id:'devops', name:'DevOps Agent', initial:'D', mark:'↗', specialty:'构建 · 部署 · 验证', detail:'检查运行与交付环节。' },
] as const;
const modes = [
  { id:'sequential', label:'顺序协作', short:'按顺序', description:'前一位完成后，交给下一位。' },
  { id:'parallel', label:'并行协作', short:'同时进行', description:'成员分别处理，共享同一个目标。' },
  { id:'router', label:'路由分配', short:'按需分配', description:'根据任务，交给合适的成员。' },
] as const;
const samples = [
  { id:'all', label:'组合效果' }, { id:'selection', label:'Agent 选择' },
  { id:'input', label:'输入与动作' }, { id:'preview', label:'协作组预览' },
] as const;
type Sample = typeof samples[number]['id'];
function initialSample(): Sample {
  return samples.find(item => item.id === new URLSearchParams(window.location.search).get('sample'))?.id ?? 'all';
}

function AgentMark({ id, mark }: { id: string; mark: string }) {
  return <span className={`as-agent-illustration is-${id}`} aria-hidden="true">
    <span className="as-identity-plane is-back"/>
    <span className="as-identity-plane is-middle"/>
    <span className="as-agent-mark">{mark}</span>
  </span>;
}

function MemberComposition({ members, mode }: {
  members: ReadonlyArray<typeof agents[number]>; mode: typeof modes[number]['id'];
}) {
  return <div className="as-relation-surface" data-material-surface="relationship" data-mode={mode}>
    <div className="as-relation-label"><span>成员关系</span><span>{mode === 'sequential' ? '依次交接' : mode === 'parallel' ? '共同处理' : '按任务分配'}</span></div>
    <div className="as-relation-members" role="list" aria-label="当前协作成员关系">
      {members.map((item,index) => <div className={`as-relation-member is-${item.id}`} role="listitem" key={item.id}>
        <div className="as-relation-identity"><AgentMark id={item.id} mark={item.mark}/>
          <span className="as-member-order">{String(index+1).padStart(2,'0')}</span></div>
        <span className="as-relation-name">{item.name}</span>
      </div>)}
      {!members.length && <p className="as-relation-empty">选择成员，预览他们的协作关系。</p>}
    </div>
    <div className="as-relation-caption"><Icon iconId="users" size={12} strokeWidth={1.3}/><span>共享目标 · 独立能力</span></div>
  </div>;
}

export function AgentStyleStudy({ onCatalogue }: { onCatalogue: (id?: string) => void }) {
  const [sample, setSample] = useState<Sample>(initialSample);
  const [selected, setSelected] = useState<string[]>(['review','writing']);
  const [mode, setMode] = useState<typeof modes[number]['id']>('sequential');
  const [name, setName] = useState('Design Review');
  const [description, setDescription] = useState('共同评审这次界面设计，整理问题与改进建议。');
  const [created, setCreated] = useState(false);
  const [details, setDetails] = useState(false);
  const [message, setMessage] = useState('请一起评审这次界面设计。');
  const [discussion, setDiscussion] = useState<string[]>([]);
  const [feedback, setFeedback] = useState('');
  const nameInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const members = agents.filter(item => selected.includes(item.id));
  const currentMode = modes.find(item => item.id === mode)!;
  const title = name.trim() || '未命名协作组';
  const visible = (id: Sample) => sample === 'all' || sample === id;

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('eles','expression');
    if (sample === 'all') url.searchParams.delete('sample'); else url.searchParams.set('sample',sample);
    url.searchParams.delete('calibration'); url.searchParams.delete('content'); url.searchParams.delete('ele');
    window.history.replaceState(null,'',url);
  }, [sample]);
  function toggle(id: string) {
    setSelected(old => old.includes(id) ? old.filter(value => value !== id) : [...old,id]);
    setCreated(false); setFeedback('');
  }
  function create() {
    if (!name.trim() || !members.length) return;
    setCreated(true); setFeedback(`已创建本地示例“${title}”，包含 ${members.length} 位 Agent。`);
  }
  function send() {
    if (!message.trim() || !members.length) return;
    setDiscussion(old => [...old,message.trim()]); setMessage('');
    setFeedback(`已在“${title}”下记录这条示例讨论。`); messageInput.current?.focus();
  }

  return <main className="as-review" data-agent-style-study data-candidate-status={expressionCandidate.status}>
    <nav className="as-sample-nav" aria-label="Agent 表达样本">{samples.map(item =>
      <Button key={item.id} actionId={`agent-style.view.${item.id}`} emphasis="quiet" aria-pressed={sample === item.id}
        onActivate={() => setSample(item.id)}>{item.label}</Button>)}<span>UI-F01 · 待认可</span></nav>
    <div className="as-scene" data-sample={sample}>
      <header className="as-scene-heading"><div><span>PEERS / WORKSPACE</span><h2>Agent Groups<span>创建与预览</span></h2></div>
        <div className="as-scene-meta"><span className="as-meta-mark"><Icon iconId="layers" size={16} strokeWidth={1.3}/></span>
          <span>一个目标<br/>多种能力</span></div></header>
      <div className="as-workspace">
        {(visible('selection') || visible('input')) && <section className="as-builder" aria-label="创建协作组">
          <div className="as-section-title"><h3>创建协作组</h3><span>01 / COMPOSE</span></div>
          {visible('selection') && <div className="as-selection" data-agent-sample="selection">
            <Segmented className="as-mode-track" label="编排方式" fullWidth density="compact"
              options={modes.map(item => ({value:item.id,label:item.label}))} value={mode}
              onValueChange={value => { setMode(value); setCreated(false); }}/>
            <div className="as-field-heading"><span>选择成员</span><span>{members.length} / {agents.length}</span></div>
            <div className="as-agent-options" role="group" aria-label="协作组成员">{agents.map(item =>
              <Button key={item.id} actionId={`agent-style.member.${item.id}`} emphasis="quiet" className="as-agent-option"
                aria-label={item.name} aria-pressed={selected.includes(item.id)} onActivate={() => toggle(item.id)}>
                <span className={`as-agent-content is-${item.id}`} data-material-surface="identity"><AgentMark id={item.id} mark={item.mark}/>
                  <span className="as-agent-check"><Icon iconId={selected.includes(item.id) ? 'check' : 'plus'} size={12}/></span>
                  <span className="as-agent-specialty">{item.specialty}</span></span>
                <span className="as-agent-label">{item.name}</span>
              </Button>)}</div>
            <p className="as-mode-note"><Icon iconId="arrow-right" size={12}/>{currentMode.description}</p>
          </div>}
          {visible('input') && <div className="as-inputs" data-agent-sample="input">
            <label htmlFor="agent-study-name">协作组名称</label>
            <TextField id="agent-study-name" ref={nameInput} value={name} placeholder="给协作组取一个名字"
              onChange={event => { setName(event.target.value); setCreated(false); }}/>
            <label htmlFor="agent-study-description">共同目标</label>
            <TextArea id="agent-study-description" rows={2} value={description} placeholder="描述这个协作组要完成的事"
              onChange={event => { setDescription(event.target.value); setCreated(false); }}/>
            <div className="as-create-row"><span>{created ? '已创建示例' : '准备好后，开始协作。'}</span>
              <Button actionId="agent-style.create" label={created ? '已创建协作组' : '创建协作组'} className="as-create" emphasis="primary"
                data-created={created} data-material-surface="action"
                trailing={<Icon iconId="arrow-up-right" size={15}/>}
                availability={name.trim() && members.length ? undefined : {kind:'disabled',reason:!name.trim() ? '请填写协作组名称' : '请至少选择一位成员'}}
                onActivate={create}/></div>
          </div>}
        </section>}
        {visible('preview') && <section className="as-group-preview" data-agent-sample="preview" aria-label="协作组预览">
          <div className="as-preview-heading"><div className="as-group-identity"><span className="as-group-symbol"><Icon iconId="users" size={23} strokeWidth={1.35}/></span>
            <div><span className="as-preview-eyebrow">YOUR AGENT GROUP</span><h3>{title}</h3></div></div>
            <span className="as-preview-state" data-created={created}>{created ? '已创建' : '草稿'}</span></div>
          <p className="as-group-goal">{description.trim() || '为协作组写下一个共同目标。'}</p>
          <MemberComposition members={members} mode={mode}/>
          <div className="as-attached-summary" aria-label="当前协作组摘要">
            <div><strong>{String(members.length).padStart(2,'0')}</strong><span>协作成员</span></div>
            <div><strong className="as-summary-mode">{currentMode.short}</strong><span>编排方式</span></div>
            <div><strong>{String(discussion.length).padStart(2,'0')}</strong><span>示例讨论</span></div>
          </div>
          <div className="as-member-line"><div className="as-avatars" aria-label="已选成员">{members.map(item =>
            <Avatar key={item.id} name={item.name} fallback={item.initial} size={30} style={{borderRadius:'var(--pt-radius-md)'}}/>)}</div>
            <span>{members.length ? '围绕同一个目标' : '从左侧选择成员'}</span>
            <IconButton actionId="agent-style.details" emphasis="quiet" iconId={details ? 'minus' : 'arrow-up-right'} iconSize={15}
              label={details ? '收起成员说明' : '查看成员说明'} aria-expanded={details} aria-controls="agent-study-member-details"
              onActivate={() => setDetails(old => !old)}/></div>
          <div className="as-member-notes" id="agent-study-member-details">
            {(details ? members : members.slice(0,2)).map(item => <div className="as-member-note" key={item.id}>
              <Avatar name={item.name} fallback={item.initial} size={26} style={{borderRadius:'var(--pt-radius-sm)'}}/>
              <div><span>{item.name}</span><p>{item.detail}</p></div></div>)}
            {!members.length && <p className="as-no-members">选好成员后，预览他们如何围绕目标协作。</p>}
          </div>
          {discussion.length > 0 && <div className="as-discussion" aria-label="当前示例讨论">{discussion.map((text,index) =>
            <div key={index}><span>你</span><p>{text}</p></div>)}</div>}
          <div className="as-composer"><label className="as-sr-only" htmlFor="agent-study-message">给协作组的消息</label>
            <TextArea id="agent-study-message" ref={messageInput} rows={2} framing="embedded" value={message}
              placeholder="围绕这个目标，写下你的想法…" onChange={event => setMessage(event.target.value)}
              onEnter={event => { if (event.metaKey || event.ctrlKey) { event.preventDefault(); send(); } }}/>
            <div><span><Icon iconId="users" size={12}/>{title}</span>
              <IconButton actionId="agent-style.send" iconId="arrow-up" iconSize={15} label="记录示例讨论" emphasis="primary"
                availability={message.trim() && members.length ? undefined : {kind:'disabled',reason:'请填写消息并选择成员'}}
                onActivate={send}/></div></div>
        </section>}
      </div>
    </div>
    <p className="as-feedback" role="status" aria-live="polite">{feedback || '完整表达候选 · 操作只作用于本地 Agent 样本'}</p>
    <details className="as-contract"><summary>表达依据与组件合同</summary>
      <p>整版共同处理暖白/奶油底层、薄荷与灰青表面、琥珀选择、渐变色彩弥散、
        透光身份层、细边界与短阴影、轻重排版、非对称空间、附着摘要和状态反馈。
        样本内容来自现有 Agent Groups 字段与 Agent 原型身份；不导入外部业务域、地图、第三方品牌或其它业务模型。</p>
      <p>方圆来自共享几何。本轮属于 UI-F01，保持 draft；实际 Agent 页面替换、创建链路与框架收益尚未展开。</p>
      <div>{['button','agentavatar','input','segmented','block'].map(id =>
        <Button key={id} actionId={`agent-style.contract.${id}`} emphasis="inline" onActivate={() => onCatalogue(`ui.spec.${id}`)}>
          {`ui.spec.${id}`}</Button>)}</div>
    </details>
  </main>;
}
