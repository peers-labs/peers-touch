import { useState, type ReactNode } from 'react';
import {
  ActionGroup, AgentAvatar, Avatar, AvatarGroup, Badge, Block, Button, Card, Center,
  Divider, EmojiArtwork, FileTypeGlyph, Flex, Grid, GroupAvatar, Header, Heading,
  Icon, IconButton, Link, PageHeader, Paragraph, Segmented, ShortcutHint,
  Tag, Text, capabilityCatalogue, type IconId,
} from '@peers-touch/ui';
import './foundation-specimens.css';
import { ButtonContractSpecimen } from './ButtonContractSpecimen';

export const foundationKeys = [
  'text', 'icon', 'button', 'actionicon', 'actionicongroup', 'a', 'avatar',
  'agentavatar', 'groupavatar', 'filetypeicon', 'fluentemoji', 'badge', 'tag',
  'hotkey', 'block', 'divider', 'flex', 'grid', 'card', 'header',
] as const;
export const foundationIds = new Set(foundationKeys.map(key => `ui.spec.${key}`));
type FoundationKey = typeof foundationKeys[number];
type Condition = 'normal' | 'long' | 'disabled';
interface SampleProps { condition: Condition }
const people = [{id:'c',name:'Code Review'}, {id:'w',name:'Writing Assistant'}, {id:'d',name:'DevOps'}, {id:'y',name:'You'}];
const names: Record<FoundationKey, string> = {
  text:'文字与层级', icon:'语义图标', button:'按钮与分支动作', actionicon:'图标动作',
  actionicongroup:'动作组', a:'链接', avatar:'人物头像', agentavatar:'Agent 身份',
  groupavatar:'协作组头像', filetypeicon:'文件类型', fluentemoji:'表情', badge:'计数与提示',
  tag:'状态与标签', hotkey:'快捷键提示', block:'内容表面', divider:'分隔',
  flex:'纵向与行内布局', grid:'网格', card:'内容卡片', header:'标题与动作轨道',
};
const disabled = (condition:Condition) => condition === 'disabled'
  ? {kind:'disabled' as const,reason:'当前为禁用样本，切回标准即可操作'} : undefined;
const label = (condition:Condition, short:string) => condition === 'long'
  ? `${short} · 共同检查实现、依据与交付结果` : short;
function Notice({children}:{children:ReactNode}) {
  return <Text className="fs-notice" tone="secondary" role="status" aria-live="polite">{children}</Text>;
}
function TypeSample({condition}:SampleProps) {
  return <div className="fs-type">
    <Text className="fs-overline" tone="secondary">ONE GOAL / MANY CAPABILITIES</Text>
    <Heading level={3}>{label(condition,'让协作清楚可见。')}</Heading>
    <Paragraph>先理解目标，再选择合适的能力。让成员、内容和下一步动作沿着同一条阅读轴展开。</Paragraph>
    <Text tone="secondary">Code Review · Writing Assistant · 2 位协作成员</Text>
    <Text as="code">group.design-review</Text>
    <Text truncate className="fs-truncated" title="可截断元信息，完整内容由标题提供">
      {condition === 'long' ? 'continuous_agent_collaboration_and_design_review_context_'.repeat(4) : 'Design Review / 当前协作草稿'}</Text>
  </div>;
}
function IconSample() {
  const glyphs:IconId[]=['bot','users','message-square','search','plus','check','arrow-up-right','layers','file-text','settings','copy','close'];
  return <div className="fs-glyphs">{glyphs.map(iconId =>
    <div key={iconId}><Icon iconId={iconId} size={22} strokeWidth={1.5} label={iconId}/><Text tone="secondary">{iconId}</Text></div>)}</div>;
}
function IconActionSample({condition}:SampleProps) {
  const [pinned,setPinned]=useState(false), [expanded,setExpanded]=useState(false);
  return <Flex gap="var(--pt-space-md)">
    <ActionGroup label="协作组工具">
      <IconButton actionId="foundation.pin" label={pinned?'取消收藏':'收藏协作组'} iconId={pinned?'check':'star'}
        emphasis="quiet" aria-pressed={pinned} availability={disabled(condition)} onActivate={()=>setPinned(!pinned)}/>
      <IconButton actionId="foundation.expand" label={expanded?'收起说明':'展开说明'} iconId={expanded?'minus':'plus'}
        emphasis="secondary" aria-expanded={expanded} availability={disabled(condition)} onActivate={()=>setExpanded(!expanded)}/>
      <IconButton actionId="foundation.icon-disabled" label="等待协作成员" iconId="arrow-up-right"
        availability={{kind:'disabled',reason:'至少需要一位协作成员'}}/>
    </ActionGroup>
    <Notice>{pinned?'已收藏。':'未收藏。'}{expanded?' 协作组共享目标，每位 Agent 保持独立能力。':' 可展开查看说明。'}</Notice>
  </Flex>;
}
function ActionGroupSample({condition}:SampleProps) {
  const [revision,setRevision]=useState(1), [detail,setDetail]=useState(false);
  return <Flex gap="var(--pt-space-md)">
    <ActionGroup label="草稿版本工具">
      <IconButton actionId="foundation.revision.previous" iconId="arrow-left" label="上一版草稿" emphasis="quiet"
        availability={revision<=1?{kind:'disabled',reason:'已是第一版'}:disabled(condition)} onActivate={()=>setRevision(revision-1)}/>
      <IconButton actionId="foundation.revision.next" iconId="arrow-right" label="下一版草稿" emphasis="quiet"
        availability={disabled(condition)} onActivate={()=>setRevision(revision+1)}/>
      <span className="fs-tool-divider" aria-hidden="true"/>
      <IconButton actionId="foundation.revision.detail" iconId="file-text" label="查看版本说明" emphasis="quiet"
        aria-pressed={detail} availability={disabled(condition)} onActivate={()=>setDetail(!detail)}/>
      <Text>{label(condition,`草稿 ${String(revision).padStart(2,'0')}`)}</Text>
    </ActionGroup>
    <Notice>{detail?`当前为第 ${revision} 版本地草稿，动作顺序与阅读顺序一致。`:'版本与说明由同一组工具控制。'}</Notice>
  </Flex>;
}
function LinkSample() {
  return <Flex gap="var(--pt-space-md)">
    <Paragraph>共同目标可以连接到 <Link href="?site=frontend-eles&eles=expression">Agent 协作组样本</Link>。</Paragraph>
    <Link href="#foundation-ui-spec-text" emphasis="quiet">返回文字样本 ↑</Link>
    <Link href="https://developer.apple.com/design/human-interface-guidelines/layout" target="_blank" rel="noreferrer">
      阅读布局参考 <Icon iconId="arrow-up-right" size={13}/></Link>
  </Flex>;
}
function AvatarSample({condition}:SampleProps) {
  return <Flex gap="var(--pt-space-md)">
    <Flex direction="row" align="center" gap="var(--pt-space-md)" wrap="wrap">
      {[24,36,52,68].map(size=><Avatar key={size} name="You" fallback="Y" size={size}/>)}
      <Text>{label(condition,'同一个人物，多种阅读尺度')}</Text>
    </Flex>
    <AvatarGroup aria-label="3 位协作成员">{people.slice(0,3).map(person=>
      <Avatar key={person.id} name={person.name} size={32}/>)}</AvatarGroup>
  </Flex>;
}
function AgentSample({condition}:SampleProps) {
  return <Flex gap="var(--pt-space-md)">{people.slice(0,3).map((person,index)=>
    <Flex key={person.id} direction="row" align="center" gap="var(--pt-space-sm)">
      <AgentAvatar name={person.name} size={index===0?52:38}/>
      <div><Text strong>{label(condition,person.name)}</Text><Paragraph tone="secondary">{['正确性 · 安全 · 性能','文档 · 结构 · 表达','构建 · 部署 · 验证'][index]}</Paragraph></div>
    </Flex>)}</Flex>;
}
function GroupSample({condition}:SampleProps) {
  return <Flex direction="row" align="center" gap="var(--pt-space-lg)" wrap="wrap">
    <GroupAvatar name="Design Review" members={people} size={64}/>
    <div><Text strong>{label(condition,'Design Review')}</Text><Paragraph tone="secondary">4 位成员 · 围绕同一个目标</Paragraph></div>
    <GroupAvatar name="Code & Writing" members={people.slice(0,2)} size={38}/>
  </Flex>;
}
function FileSample({condition}:SampleProps) {
  const files=[['review.md','text/markdown'],['context.json','application/json'],['capture.png','image/png'],['discussion.wav','audio/wav'],['walkthrough.mp4','video/mp4'],['sources.zip','application/zip']];
  return <div className="fs-files">{files.map(([filename,mimeType])=>
    <Flex key={filename} direction="row" align="center" gap="var(--pt-space-xs)">
      <FileTypeGlyph filename={filename} mimeType={mimeType} size={20} strokeWidth={1.5}/>
      <Text>{condition==='long'?`design_review_collaboration_${filename}`:filename}</Text>
    </Flex>)}</div>;
}
function EmojiSample() {
  return <><Flex direction="row" gap="var(--pt-space-lg)" wrap="wrap">
    {[['👋','打招呼'],['✨','灵感'],['🌱','成长'],['📝','写作'],['🔎','查找'],['🧩','协作']].map(([emoji,name])=>
      <EmojiArtwork key={emoji} emoji={emoji} label={name}/>)}</Flex>
    <Paragraph tone="secondary">系统原生表情 · 静态、具名。插画资源版仍待制作。</Paragraph></>;
}
function BadgeSample({condition}:SampleProps) {
  const [count,setCount]=useState(3);
  return <Flex gap="var(--pt-space-lg)">
    <Flex direction="row" align="center" gap="var(--pt-space-xl)" wrap="wrap">
      <Badge count={count} label={`${count} 条待阅讨论`}><Icon iconId="message-square" size={26} label="待阅讨论"/></Badge>
      <Badge count={128} label="128 条历史讨论"/>
      <Badge count={0} showZero label="0 条新讨论"/>
      <Badge indicator tone="success" caption="可协作" label="当前示例可协作"/>
    </Flex>
    <Button actionId="foundation.badge.add" emphasis="quiet" availability={disabled(condition)} onActivate={()=>setCount(count+1)}>增加一条示例讨论</Button>
    <Notice>{count} 条本地待阅讨论 · 显示上限保留真实数量名称。</Notice>
  </Flex>;
}
function TagSample({condition}:SampleProps) {
  const [values,setValues]=useState(['Code Review','Writing Assistant']);
  return <Flex gap="var(--pt-space-md)">
    <Flex direction="row" gap="var(--pt-space-xs)" wrap="wrap">
      <Tag>草稿</Tag><Tag tone="success" leading={<Icon iconId="check" size={12}/>}>已准备</Tag>
      <Tag tone="warning">等待成员</Tag><Tag tone="danger">需重试</Tag><Tag tone="info">本地示例</Tag>
    </Flex>
    <Flex direction="row" gap="var(--pt-space-xs)" wrap="wrap">{values.map(value=>
      <Tag key={value} dismissLabel={`移除 ${value}`} onDismiss={condition==='disabled'?undefined:()=>setValues(values.filter(item=>item!==value))}>
        {label(condition,value)}</Tag>)}</Flex>
    <Button actionId="foundation.tags.restore" emphasis="inline" availability={disabled(condition)}
      onActivate={()=>setValues(['Code Review','Writing Assistant'])}>恢复成员标签</Button>
    <Notice>{values.length} 个已选标签。</Notice>
  </Flex>;
}
function HotkeySample({condition}:SampleProps) {
  const [count,setCount]=useState(0);
  return <Flex gap="var(--pt-space-md)" onKeyDown={event=>{
    if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&condition!=='disabled'&&!event.nativeEvent.isComposing){
      event.preventDefault();setCount(count+1);
    }
  }}>
    <Button actionId="foundation.shortcut.run" availability={disabled(condition)} onActivate={()=>setCount(count+1)}
      trailing={<ShortcutHint keys={['⌘','↵']} label="Command 加 Enter"/>}>运行示例</Button>
    <Notice>聚焦此样本后，点击或按 Command / Control + Enter。已运行 {count} 次。</Notice>
  </Flex>;
}
function SurfaceSample() {
  return <Flex gap="var(--pt-space-sm)">
    <Block className="pt-material-block" data-surface="reading"><Text strong>阅读</Text><Paragraph>内容保持清楚、不透明。</Paragraph></Block>
    <Block className="pt-material-block" data-surface="action"><Text strong>协作上下文</Text><Paragraph>薄荷表面轻轻组织相关内容。</Paragraph></Block>
    <Block className="pt-material-block" data-surface="recovery"><Text strong>需要你的注意</Text><Paragraph>等待加入成员后继续。</Paragraph></Block>
  </Flex>;
}
function DividerSample() {
  return <><Text strong>共同目标</Text><Paragraph>评审界面与交互。</Paragraph><Divider/>
    <Flex direction="row" gap="var(--pt-space-md)" align="center"><Text>2 位成员</Text>
      <span className="fs-tool-divider" aria-hidden="true"/><Text tone="secondary">顺序协作</Text></Flex>
    <Divider aria-hidden="true"/><Text tone="secondary">分隔只表达内容关系，不代替内容层级。</Text></>;
}
function FlexSample({condition}:SampleProps) {
  return <Flex gap="var(--pt-space-lg)">
    <Flex direction="row" align="center" justify="space-between" gap="var(--pt-space-sm)" wrap="wrap">
      <Flex direction="row" align="center" gap="var(--pt-space-sm)"><AgentAvatar name="Code Review" size={38}/><Text>{label(condition,'Code Review')}</Text></Flex>
      <Tag tone="success">已准备</Tag>
    </Flex>
    <Center className="pt-material-block"><Text>同一内容轴 · 子元素保持自然顺序</Text></Center>
  </Flex>;
}
function GridSample({condition}:SampleProps) {
  return <Grid columns="repeat(auto-fit,minmax(min(100%,120px),1fr))" gap="var(--pt-space-md)">
    {people.slice(0,3).map(person=><Flex key={person.id} className="fs-grid-person" gap="var(--pt-space-sm)">
      <AgentAvatar name={person.name} size={46}/><Text strong>{label(condition,person.name)}</Text><Text tone="secondary">独立能力</Text>
    </Flex>)}</Grid>;
}
function CardSample({condition}:SampleProps) {
  const [saved,setSaved]=useState(false);
  return <Card heading={<Heading level={3}>{label(condition,'Design Review')}</Heading>}
    actions={<IconButton actionId="foundation.card.save" label={saved?'取消收藏卡片':'收藏卡片'} iconId={saved?'check':'star'}
      emphasis="quiet" aria-pressed={saved} availability={disabled(condition)} onActivate={()=>setSaved(!saved)}/>}
    footer={<Flex direction="row" align="center" justify="space-between" gap="var(--pt-space-xs)" wrap="wrap"><Tag>草稿</Tag><Text tone="secondary" role="status">{saved?'已收藏':'2 位成员 · 顺序协作'}</Text></Flex>}>
    <Paragraph>共同评审这次界面设计，整理问题与改进建议。</Paragraph>
    <Flex direction="row" align="center" gap="var(--pt-space-xs)"><AgentAvatar name="Code Review" size={28}/><AgentAvatar name="Writing Assistant" size={28}/><Text tone="secondary">围绕同一个目标</Text></Flex>
  </Card>;
}
function HeaderSample({condition}:SampleProps) {
  const [created,setCreated]=useState(false);
  return <Flex gap="var(--pt-space-lg)">
    <PageHeader title={label(condition,'Agent Groups')} description="组织成员，围绕共同目标协作。"
      actions={<Button actionId="foundation.header.create" emphasis="primary" availability={disabled(condition)}
        leading={<Icon iconId="plus" size={16}/>} onActivate={()=>setCreated(true)}>创建协作组</Button>}/>
    <Divider aria-hidden="true"/>
    <Header className="fs-panel-header"><Text strong>最近的协作</Text><Text tone="secondary">02</Text></Header>
    <Notice>{created?'已创建一个本地协作组示例。':'标题、上下文和一个主要动作共享稳定轨道。'}</Notice>
  </Flex>;
}
const renderers:Record<FoundationKey,(props:SampleProps)=>ReactNode>={
  text:TypeSample,icon:IconSample,button:ButtonContractSpecimen,actionicon:IconActionSample,
  actionicongroup:ActionGroupSample,a:LinkSample,avatar:AvatarSample,agentavatar:AgentSample,
  groupavatar:GroupSample,filetypeicon:FileSample,fluentemoji:EmojiSample,badge:BadgeSample,
  tag:TagSample,hotkey:HotkeySample,block:SurfaceSample,divider:DividerSample,
  flex:FlexSample,grid:GridSample,card:CardSample,header:HeaderSample,
};
export function FoundationSpecimen({id,condition='normal'}:{id:string;condition?:Condition}) {
  const key=id.replace('ui.spec.','') as FoundationKey, Renderer=renderers[key];
  return Renderer?<div className="fs-specimen" data-foundation-id={id}><Renderer condition={condition}/></div>:null;
}
export function FoundationSpecimens({onCatalogue}:{onCatalogue:(id:string)=>void}) {
  const [condition,setCondition]=useState<Condition>('normal');
  return <main className="fs-review" data-foundation-specimens>
    <Header className="fs-heading"><div><Text className="fs-overline" tone="secondary">PEERS / THE MATERIAL DESK</Text>
      <Heading level={2}>基础，成为同一种语言。</Heading>
      <Paragraph tone="secondary">20 项基础组件 · 暖白、薄荷、灰青与琥珀 · 每一项都可以细看。</Paragraph></div>
      <Segmented label="基础样本条件" value={condition} onValueChange={setCondition} options={[
        {value:'normal',label:'标准'},{value:'long',label:'长文案'},{value:'disabled',label:'禁用'},
      ]}/></Header>
    <div className="fs-samples">{foundationKeys.map((key,index)=>{
      const id=`ui.spec.${key}`,entry=capabilityCatalogue.find(item=>item.id===id)!;
      return <section key={id} id={`foundation-${id.replaceAll('.','-')}`} className="fs-sample" aria-labelledby={`fs-title-${key}`}>
        <header className="fs-sample-heading"><div><Text className="fs-number" tone="secondary">{String(index+1).padStart(2,'0')}</Text>
          <Heading level={3} id={`fs-title-${key}`}>{names[key]}</Heading><Text tone="secondary">{entry.exports.join(' / ')}</Text></div>
          <Button actionId={`foundation.inspect.${key}`} emphasis="inline" aria-label={`细看${names[key]}`}
            trailing={<Icon iconId="arrow-up-right" size={14}/>} onActivate={()=>onCatalogue(id)}>细看</Button></header>
        <FoundationSpecimen id={id} condition={condition}/>
      </section>;
    })}</div>
    <Paragraph className="fs-footer" tone="secondary">样式与交互样本已制作，20 项均待审阅。高级组件和业务组合继续保留完整定义。</Paragraph>
  </main>;
}
