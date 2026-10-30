import { useState } from 'react';
import * as UI from '@peers-touch/ui';

/** Local presentation fixtures only. No transport, authorization or receiver outcomes are simulated here. */
export function DomainSpecimen({id}:{id:string}) {
  const [state,setState]=useState('waiting'),[draft,setDraft]=useState('保留这份未提交的消息。'),[open,setOpen]=useState(false);
  const [selected,setSelected]=useState(false),[count,setCount]=useState(3),[step,setStep]=useState(0),[view,setView]=useState('workspace');
  const readback=<UI.Text role="status" data-specimen-readback>本地投影：{state}</UI.Text>;
  const action=(id:string,label:string,next:string,tone?:UI.Tone)=><UI.Button actionId={`domain.${id}`} label={label} tone={tone}
    onActivate={()=>setState(next)}/>;
  const identity=<UI.ListItemMeta avatar={<UI.Avatar name="林"/>} title="林" description="当前工作区 · 已确认联系人"/>;
  const decisions=<UI.ActionGroup label="当前请求决策">{action('accept','接受当前请求','accepted')}{action('reject','拒绝当前请求','rejected')}</UI.ActionGroup>;
  switch(id) {
    case 'relationshiprequestitem':return <UI.Flex gap={16}><UI.ListItem actions={state==='waiting'?decisions:<UI.Tag>{state}</UI.Tag>}>{identity}</UI.ListItem>
      <UI.Text>请求对象和双向决策属于同一行；等待、处理和终态独立。</UI.Text>{readback}</UI.Flex>;
    case 'contactitem':return <UI.Flex gap={16}><UI.ListItem actions={action('contact-message','向林发消息','message-requested')}>{identity}</UI.ListItem>{readback}</UI.Flex>;
    case 'conversationitem':return <UI.Flex gap={16}><UI.Button actionId="domain.conversation" emphasis="quiet" fullWidth onActivate={()=>setState('conversation-opened')}>
      <UI.ListItemMeta avatar={<UI.Avatar name="项目群"/>} title="项目群" description={`草稿：${draft}`}/><UI.Badge count={3} label="3 条未读"/></UI.Button>{readback}</UI.Flex>;
    case 'messagebubble':return <UI.Flex gap={16}><UI.Card><UI.Text>{draft}</UI.Text><UI.Flex direction="row" justify="space-between"><UI.Text tone="secondary">林 · 10:28</UI.Text>
      <UI.Tag tone={state==='failed'?'danger':'neutral'}>{state==='waiting'?'待发送':state==='pending'?'等待回读':state==='failed'?'发送失败':'本地投影已回读'}</UI.Tag></UI.Flex></UI.Card>
      <UI.ActionGroup label="消息状态样本">{action('message.pending','等待回读','pending')}{action('message.fail','注入失败','failed')}{action('message.recovery','恢复重试','waiting')}</UI.ActionGroup></UI.Flex>;
    case 'messagecomposer':return <UI.Flex gap={16}><UI.Field label="当前会话草稿"><UI.TextArea value={draft} onChange={e=>setDraft(e.target.value)}/></UI.Field>
      <UI.ActionGroup label="草稿动作"><UI.Button actionId="domain.composer.send" label="发送到当前会话" emphasis="primary" execution={state==='pending'?'pending':'idle'}
        availability={!draft.trim()?{kind:'disabled',reason:'填写消息内容'}:undefined} onActivate={()=>setState('pending')}/>
        {action('composer.fail','注入发送失败','failed')}{action('composer.recover','恢复输入','waiting')}</UI.ActionGroup>
      {state==='failed'&&<UI.Alert title="发送失败，草稿已保留" tone="danger"/>}{readback}</UI.Flex>;
    case 'attachmentitem':return <UI.Flex gap={16}><UI.ListItem actions={action('attachment.open','查看附件','attachment-open-requested')}>
      <UI.ListItemMeta avatar={<UI.FileTypeGlyph filename="design.pdf"/>} title="design.pdf" description="240 KB · 当前会话附件"/></UI.ListItem>
      <UI.Progress value={state==='waiting'?35:100} label="附件传输样本"/>{readback}</UI.Flex>;
    case 'attachmentviewer':return <UI.Flex gap={16}><UI.Button actionId="domain.viewer.open" label="查看附件详情" onActivate={()=>setOpen(true)}/>
      <UI.Drawer open={open} title="design.pdf" onDismiss={()=>setOpen(false)}><UI.Descriptions items={[{id:'source',label:'来源',content:'当前会话'},{id:'access',label:'访问状态',content:'等待资源 Owner 验证'}]}/>
        <UI.Empty description="尚未取得已授权资源"/>{action('viewer.resolve','请求附件访问','access-requested')}</UI.Drawer>{readback}</UI.Flex>;
    case 'reactionchip':return <UI.Flex gap={16}><UI.Toggle actionId="domain.reaction" label={`赞同 ${count}`} selected={selected}
      onSelectedChange={next=>{setSelected(next);setCount(count+(next?1:-1));}}/>
      <UI.EmojiPicker label="选择表情反应" items={[{id:'like',emoji:'👍',name:'赞同'},{id:'thanks',emoji:'🙏',name:'感谢'}]} onSelect={setState}/>{readback}</UI.Flex>;
    case 'identityblock':return <UI.ListItem>{identity}<UI.Descriptions items={[{id:'station',label:'工作区',content:'当前工作区'},{id:'audience',label:'可见范围',content:'已确认联系人'}]}/></UI.ListItem>;
    case 'trustindicator':return <UI.Flex gap={16}><UI.Alert tone="warning" title="联系人身份尚未确认" description="确认之前不能共享私密文档。"
      action={action('trust.verify','查看身份依据','identity-evidence-requested')}/>{readback}</UI.Flex>;
    case 'permissiondecision':return <UI.Flex gap={16}><UI.Card heading="工作区助手请求读取文档"><UI.Descriptions items={[
      {id:'actor',label:'请求方',content:'工作区助手'},{id:'scope',label:'范围',content:'当前文档 · 只读'},{id:'expiry',label:'期限',content:'仅本次操作'}]}/>
      <UI.ActionGroup label="读取权限决策">{action('permission.allow','仅允许本次读取','allow-once-requested')}{action('permission.deny','拒绝读取','denied')}</UI.ActionGroup></UI.Card>{readback}</UI.Flex>;
    case 'agenttaskcard':return <UI.Flex gap={16}><UI.Card heading="整理当前文档"><UI.Steps items={[{id:'read',title:'读取',state:'completed'},{id:'review',title:'整理',state:state==='stopped'?'failed':'current'},{id:'finish',title:'回读',state:'pending'}]}/>
      <UI.ActionGroup label="任务动作">{action('agent.stop','请求停止任务','stop-requested')}{action('agent.stopped','回读已停止','stopped')}{action('agent.retry','重试整理','waiting')}</UI.ActionGroup></UI.Card>{readback}</UI.Flex>;
    case 'toolcallcard':return <UI.Flex gap={16}><UI.Card heading="读取当前文档"><UI.Descriptions items={[{id:'tool',label:'工具',content:'文档读取'},{id:'path',label:'对象',content:'design.md'},{id:'mode',label:'范围',content:'只读'}]}/>
      <UI.Collapsible title="查看调用输入"><UI.CodeSnippet code={'{"resource":"design.md","access":"read"}'} language="json"/></UI.Collapsible>
      <UI.Tag tone={state==='failed'?'danger':'neutral'}>{state}</UI.Tag>{action('tool.fail','注入调用失败','failed')}{action('tool.retry','请求重试','retry-requested')}</UI.Card>{readback}</UI.Flex>;
    case 'devicelinkcard':return <UI.Flex gap={16}><UI.Card heading="连接新设备">{state==='expired'?<UI.Alert title="设备连接已过期" tone="warning"/>:
      <UI.QrCode label="设备连接演示符号，不能用于登录" value="peers-ui-gallery:device-link-demo"/>}
      <UI.Text>演示会话 · 等待新设备确认 · 不授予真实权限</UI.Text><UI.ActionGroup label="连接生命周期">{action('device.approve','确认连接意图','approval-requested')}
        {action('device.expire','注入过期','expired')}{action('device.refresh','申请新连接','waiting')}</UI.ActionGroup></UI.Card>{readback}</UI.Flex>;
    case 'connectionrecovery':return <UI.Flex gap={16}><UI.Alert tone="warning" title="当前工作区连接中断" description="本地草稿保留；其他工作区不受影响。"
      action={action('connection.retry','重连当前工作区','reconnect-requested')}/><UI.Text>草稿：{draft}</UI.Text>{readback}</UI.Flex>;
    case 'notificationitem':return <UI.Flex gap={16}><UI.ListItem actions={action('notification.open','查看请求','notification-opened')}>
      <UI.ListItemMeta avatar={<UI.Avatar name="林"/>} title="林发来联系人请求" description="刚刚 · 当前工作区"/></UI.ListItem>
      <UI.Text>打开通知不等于接受请求。</UI.Text>{readback}</UI.Flex>;
    case 'navigationshell':return <div style={{height:300}}><UI.Layout header={<UI.PageHeader title="工作区" actions={<UI.Button actionId="domain.global-settings" label="全局设置" onActivate={()=>setView('settings')}/>}/>}
      sidebar={<UI.SideNav value={view} items={[{id:'workspace',label:'工作区',onActivate:()=>setView('workspace')},{id:'messages',label:'消息',onActivate:()=>setView('messages')}]}/>}>
      {view==='settings'?<UI.Card heading="全局设置"><UI.Field label="显示名称"><UI.TextField value={draft} onChange={e=>setDraft(e.target.value)}/></UI.Field></UI.Card>
        :<UI.Card heading={view==='workspace'?'当前任务':'消息'}><UI.Text>{draft}</UI.Text></UI.Card>}</UI.Layout></div>;
    case 'applettile':return <UI.Flex gap={16}><UI.Card heading="文档小应用" actions={action('applet.open','打开文档小应用','applet-open-requested')}>
      <UI.Icon iconId="notebook-pen"/><UI.Text>工作区文档 · 当前身份可访问</UI.Text></UI.Card>{readback}</UI.Flex>;
    case 'resourceusage':return <UI.Flex gap={16}><UI.Statistic label="当前任务已用预算" value={count} suffix=" / 10"/>
      <UI.Progress value={count} maximum={10} label="任务预算"/><UI.Button actionId="domain.usage" label="增加样本使用量" onActivate={()=>setCount(Math.min(10,count+1))}/>
      {count===10&&<UI.Alert title="预算已用完，等待后续决策" tone="warning"/>}</UI.Flex>;
    case 'onboardingflow':return <UI.Flex gap={16}><UI.Steps items={['选择工作区','确认身份','开始使用'].map((title,i)=>({id:String(i),title,state:i<step?'completed':i===step?'current':'pending'}))}/>
      <UI.Text>{step===0?'选择你有权访问的工作区。':step===1?'核验当前身份和可见范围。':'已完成本地流程样本。'}</UI.Text>
      <UI.ActionGroup label="引导步骤"><UI.Button actionId="domain.onboarding.previous" label="上一步" availability={step===0?{kind:'disabled',reason:'首个步骤'}:undefined} onActivate={()=>setStep(step-1)}/>
        <UI.Button actionId="domain.onboarding.next" label="下一步" availability={step===2?{kind:'disabled',reason:'流程样本已完成'}:undefined} onActivate={()=>setStep(step+1)}/></UI.ActionGroup></UI.Flex>;
    case 'settingrow':return <UI.Flex gap={16}><UI.ListItem><UI.ListItemMeta title="启用工作区同步" description="仅影响当前工作区。"/>
      <UI.Switch label="工作区同步" checked={selected} onCheckedChange={setSelected}/></UI.ListItem><UI.ListItem><UI.ListItemMeta title="显示名称" description="未保存时保留草稿。"/>
        <UI.TextField aria-label="显示名称" value={draft} onChange={e=>setDraft(e.target.value)}/></UI.ListItem>{action('settings.save','保存当前工作区更改','save-requested')}{readback}</UI.Flex>;
    default:throw new Error(`No domain specimen registered for ${id}`);
  }
}
