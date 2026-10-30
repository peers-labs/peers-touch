import { useEffect, useMemo, useState } from 'react';
import * as UI from '@peers-touch/ui';
import { glyphs } from '@peers-touch/ui-assets';

const choices=[{value:'local',label:'本地工作区'},{value:'remote',label:'远程工作区'},
  {value:'locked',label:'受限工作区',availability:{kind:'disabled' as const,reason:'当前身份没有访问权限'}}];
const generatedImage=`https://copilot-cn.bytedance.net/api/ide/v1/tool_text_to_image?prompt=${encodeURIComponent('realistic photograph of a quiet contemporary library, warm oak shelves, soft daylight through a window, no people, editorial architectural photography, clean composition, natural colors')}&image_size=landscape_4_3`;
const media: UI.ResourceView={resourceId:'gallery.library',name:'图书馆照片',source:generatedImage,state:'available'};
export function PrimitiveSpecimen({id}:{id:string}) {
  const [text,setText]=useState('保留这份草稿'),[value,setValue]=useState('local'),[many,setMany]=useState<string[]>(['local']);
  const [number,setNumber]=useState(24),[checked,setChecked]=useState(false),[open,setOpen]=useState(false);
  const [result,setResult]=useState('尚未激活'),[color,setColor]=useState('#6b5bd6'),[date,setDate]=useState('2026-10-28');
  const [range,setRange]=useState<[string,string]>(['2026-10-28','2026-11-02']),[order,setOrder]=useState(['草稿','审核','发布']);
  const [size,setSize]=useState(260),[position,setPosition]=useState({x:420,y:180}),[query,setQuery]=useState('');
  const [channel]=useState(UI.createToastChannel), [page,setPage]=useState(1);
  const controller=UI.useFormController({name:'',enabled:true});
  useEffect(()=>()=>{if(query.startsWith('blob:'))URL.revokeObjectURL(query);},[query]);
  const rows=useMemo(()=>Array.from({length:80},(_,i)=>({id:`row-${i}`,name:`任务 ${i+1}`,count:80-i})),[]);
  const commands=[{id:'search',label:'搜索工作区',description:'查找本地文档'},{id:'rename',label:'重命名草稿'},
    {id:'locked',label:'发布到工作区',disabledReason:'缺少发布权限'}];
  const actions=commands.map(command=>({id:command.id,label:command.label,availability:command.disabledReason?{kind:'disabled' as const,reason:command.disabledReason}:undefined,
    onActivate:()=>setResult(command.label)}));
  const status=<UI.Text role="status" data-specimen-readback>{result}</UI.Text>;
  const name=(node:React.ReactNode)=><UI.Flex gap={16}>{node}{status}</UI.Flex>;
  switch(id) {
    case 'button':return name(<UI.Flex gap={16}><UI.ActionGroup label="动作层级">{(['primary','secondary','quiet','inline'] as const).map(emphasis=>
      <UI.Button key={emphasis} actionId={`sample.${emphasis}`} label="保存草稿" emphasis={emphasis} onActivate={()=>setResult(`${emphasis} 已激活`)}/>)}</UI.ActionGroup>
      <UI.Button actionId="sample.pending" label="正在保存" execution="pending"/><UI.Button actionId="sample.disabled" label="发布草稿" availability={{kind:'disabled',reason:'没有发布权限'}}/>
      <UI.SplitButton actionId="sample.send" label="发送" onActivate={()=>setResult('主动作已激活')} alternativesLabel="发送方式" alternatives={actions}/></UI.Flex>);
    case 'actionicon':return name(<UI.ActionGroup label="文档快捷动作"><UI.IconButton actionId="sample.search" iconId="search" label="搜索文档" onActivate={()=>setResult('已激活文档搜索')}/>
      <UI.IconButton actionId="sample.copy-link" iconId="copy" label="复制文档链接" onActivate={()=>setResult('已激活链接复制')}/></UI.ActionGroup>);
    case 'actionicongroup':return name(<UI.ActionGroup label="同一文档"><UI.Button actionId="sample.edit" label="编辑" onActivate={()=>setResult('编辑当前文档')}/>
      <UI.Button actionId="sample.archive" label="归档" onActivate={()=>setResult('归档当前文档')}/></UI.ActionGroup>);
    case 'copybutton':return name(<><UI.CopyButton actionId="sample.copy" text={text} label="复制草稿" copiedLabel="已复制" onCopyError={()=>setResult('复制失败，草稿仍可手动选择')}/><UI.Text>{text}</UI.Text></>);
    case 'downloadbutton':return <UI.DownloadButton source="data:text/plain;charset=utf-8,Peers%20UI%20sample" filename="peers-ui-sample.txt" label="下载样本文本"/>;
    case 'confirmaction':return name(<UI.ConfirmAction actionId="sample.delete" title="删除当前草稿？" description={text} confirmLabel="删除当前草稿" cancelLabel="保留草稿"
      onConfirm={()=>{setText('');setResult('本地样本草稿已删除');}}><UI.Button actionId="sample.request-delete" label="删除当前草稿" tone="danger"/></UI.ConfirmAction>);
    case 'overflowtoolbar':return name(<UI.OverflowToolbar label="文档动作" actions={actions} visibleCount={1}/>);
    case 'input':return <UI.Grid columns={2}><UI.Field label="草稿名称"><UI.TextField value={text} onChange={e=>setText(e.target.value)}/></UI.Field>
      <UI.Field label="访问密码"><UI.PasswordField defaultValue="demo-secret"/></UI.Field><UI.Field label="保留数量"><UI.NumberField value={number} onValueChange={v=>setNumber(v??0)} min={0}/></UI.Field>
      <UI.OTPField label="设备验证码" value={query} onValueChange={setQuery}/><UI.Field label="多行草稿"><UI.TextArea value={text} onChange={e=>setText(e.target.value)}/></UI.Field>
      <UI.Text role="status">草稿：{text} / 数量：{number} / 验证码：{query}</UI.Text></UI.Grid>;
    case 'autocomplete':return name(<UI.Autocomplete label="查找工作区" projection={{queryId:query.length,query,state:'ready',items:choices.filter(option=>option.label.includes(query))}}
      onQueryChange={setQuery} onSelect={id=>setResult(`选中 ${id}`)}/>);
    case 'checkbox':return <UI.Flex gap={16}><UI.Checkbox checked={checked} onChange={e=>setChecked(e.target.checked)}>选择附件</UI.Checkbox>
      <UI.CheckboxGroup label="可见工作区" options={choices} value={many} onValueChange={setMany}/><UI.Text role="status">{checked?'附件已选择':'附件未选择'} / {many.join(', ')}</UI.Text></UI.Flex>;
    case 'radio':return <UI.Flex gap={16}><UI.RadioGroup label="默认工作区" options={choices} value={value} onValueChange={setValue}/><UI.Text role="status">{value}</UI.Text></UI.Flex>;
    case 'switch':return <UI.Switch label="同步" checked={checked} onCheckedChange={setChecked} checkedLabel="已启用" uncheckedLabel="已关闭"/>;
    case 'select':return <UI.Flex gap={16}><UI.Select label="工作区" searchable clearable options={choices} value={value} onValueChange={v=>setValue(typeof v==='string'?v:'')}/>
      <UI.Select label="多个工作区" multiple searchable options={choices} value={many} onValueChange={v=>setMany(Array.isArray(v)?v:[])}/><UI.Text role="status">{value} / {many.join(', ')}</UI.Text></UI.Flex>;
    case 'searchbar':return name(<UI.SearchField label="搜索文档" query={query} onQueryChange={setQuery} scope={<UI.Text>当前工作区</UI.Text>} onSearch={v=>setResult(`搜索意图：${v}`)}/>);
    case 'form':return name(<UI.Form controller={controller} onCommit={v=>setResult(`本地提交回读：${v.name}`)}>
      <UI.FormField name="name" label="工作区名称" rules={[{required:true,message:'填写工作区名称'}]}><UI.TextField/></UI.FormField>
      <UI.FormField name="enabled" label="同步" valueKind="checked"><UI.Switch label="启用同步"/></UI.FormField>
      <UI.Button actionId="sample.form.save" label="保存工作区" behavior="submit" emphasis="primary"/></UI.Form>);
    case 'editabletext':return name(<UI.InlineEdit label="草稿名称" value={text} onCommit={v=>{setText(v);setResult(`保存回读：${v}`);}}/>);
    case 'colorpicker':return <UI.ColorPicker label="自定义标注色" value={color} onValueChange={setColor}/>;
    case 'colorswatches':return <UI.ColorSwatches label="标注颜色" value={color} onValueChange={setColor} colors={[{value:'#6b5bd6',label:'紫色'},{value:'#25875a',label:'绿色'}]}/>;
    case 'datepicker':return <UI.Flex gap={16}><UI.DateField label="到期日期" value={date} onValueChange={setDate}/><UI.DateRangeField label="显示时间范围" value={range} onValueChange={setRange}/>
      <UI.Text role="status">{date} / {range.join(' → ')}</UI.Text></UI.Flex>;
    case 'timefield':return <UI.TimeField label="提醒时间" value={query} onValueChange={setQuery}/>;
    case 'hotkeyinput':return <UI.ShortcutField label="搜索快捷键" value={query} onValueChange={setQuery} conflict={query==='Meta+q'?'系统已使用该快捷键':undefined}/>;
    case 'imageselect':return <UI.ImageChoice label="文档图标" value={value} onValueChange={setValue} items={[{id:'local',label:'本地',artwork:<UI.Icon iconId="folder"/>},{id:'remote',label:'云端',artwork:<UI.Icon iconId="cloud"/>}]}/>;
    case 'rate':return <UI.Rating label="体验评分" value={number>5?3:number} onValueChange={setNumber}/>;
    case 'segmented':return <UI.Segmented label="工作区模式" options={choices} value={value} onValueChange={setValue}/>;
    case 'slider':return <UI.Field label={`音量 ${number}`}><UI.Slider value={number} onValueChange={setNumber} min={0} max={100}/></UI.Field>;
    case 'togglegroup':return <UI.Flex gap={16}><UI.ToggleGroup label="格式选择" options={choices.slice(0,2)} value={many} onValueChange={setMany}/>
      <UI.Toggle actionId="sample.pin" label="固定文档" selected={checked} onSelectedChange={setChecked}/></UI.Flex>;
    case 'sortablelist':return <UI.ReorderableList label="发布步骤" items={order} itemKey={item=>item} renderItem={item=><UI.Text>{item}</UI.Text>} onOrderChange={setOrder}/>;
    case 'upload':return name(<UI.FileDropzone label="选择附件" accept=".txt,.md" multiple maximumBytes={1024*1024} onFiles={files=>setResult(files.map(f=>f.name).join(', '))}
      onRejected={setResult}><UI.Text>拖放文本附件或使用文件选择器。</UI.Text></UI.FileDropzone>);
    case 'editorslashmenu':return name(<UI.SlashCommandMenu label="插入命令" commands={commands} onSelect={id=>setResult(`编辑器命令意图：${id}`)}/>);
    case 'emojipicker':return name(<UI.EmojiPicker label="选择表情" items={[{id:'wave',emoji:'👋',name:'打招呼'},{id:'thanks',emoji:'🙏',name:'感谢'}]} onSelect={setResult}/>);
    case 'mentionpicker':return name(<UI.MentionPicker label="提及联系人" commands={[{id:'alice',label:'林',description:'当前工作区'},{id:'bob',label:'周',disabledReason:'不在当前可见目录'}]} onSelect={setResult}/>);
    case 'richtexteditor':return <UI.Flex gap={16}><UI.RichTextEditor label="文档草稿" value={text} onValueChange={setText}/><UI.Text role="status">{text}</UI.Text></UI.Flex>;
    case 'treeselect':return <UI.TreeSelect label="文档位置" value={value} onValueChange={setValue} nodes={[{id:'local',label:'本地',children:[{id:'docs',label:'文档'}]},{id:'locked',label:'受限',disabledReason:'没有访问权限'}]}/>;
    case 'a':return <UI.Link href="#ui-gallery-contract">定位到当前组件合同</UI.Link>;
    case 'agentavatar':return <UI.AgentAvatar name="工作区助手" size={48}/>;
    case 'avatar':return <UI.AvatarGroup><UI.Avatar name="林"/><UI.Avatar name="Peers" size={44}/><UI.Avatar name="不可用头像" source="data:image/png,invalid"/></UI.AvatarGroup>;
    case 'groupavatar':return <UI.GroupAvatar name="项目群" size={56} members={[{id:'a',name:'林'},{id:'b',name:'周'},{id:'c',name:'吴'},{id:'d',name:'赵'}]}/>;
    case 'filetypeicon':return <UI.ActionGroup label="文件类型"><UI.FileTypeGlyph filename="note.md" label="Markdown 文档"/><UI.FileTypeGlyph mimeType="image/png" label="图像"/>
      <UI.FileTypeGlyph mimeType="audio/wav" label="音频"/><UI.FileTypeGlyph filename="archive.zip" label="压缩包"/></UI.ActionGroup>;
    case 'fluentemoji':return <UI.EmojiArtwork emoji="👋" label="打招呼" style={{fontSize:48}}/>;
    case 'icon':return <UI.Flex gap={16}><UI.Field label="查找语义图标"><UI.TextField value={query} onChange={e=>setQuery(e.target.value)}/></UI.Field><UI.Grid columns={5}>
      {(Object.keys(glyphs) as UI.IconId[]).filter(id=>id.includes(query)).slice(0,50).map(id=><UI.Flex key={id} gap={8}><UI.Icon iconId={id}/><UI.Text>{id}</UI.Text></UI.Flex>)}</UI.Grid></UI.Flex>;
    case 'alert':return name(<UI.Alert title="同步失败" description="本地草稿已保留。" tone="danger"
      action={<UI.Button actionId="sample.retry" label="重试同步" onActivate={()=>setResult('已发送重试意图')}/>}/>);
    case 'badge':return <UI.Flex gap={16}><UI.Badge count={number} label={`${number} 条未读`}><UI.Text>通知</UI.Text></UI.Badge>
      <UI.Button actionId="sample.read" label="标记本地样本已读" onActivate={()=>setNumber(0)}/></UI.Flex>;
    case 'empty':return name(<UI.Empty description="没有符合条件的文档" action={<UI.Button actionId="sample.query.clear" label="清除筛选" onActivate={()=>setResult('已清除样本筛选')}/>}/>);
    case 'guidecard':return name(<UI.GuideStep title="连接你的工作区" description="选择工作区后验证访问权限。" action={<UI.Button actionId="sample.guide" label="选择工作区" onActivate={()=>setResult('进入工作区选择')}/>}/>);
    case 'progress':return <UI.Flex gap={16}><UI.Progress value={number} label="样本上传进度"/><UI.Button actionId="sample.advance" label="增加样本进度" onActivate={()=>setNumber(Math.min(100,number+10))}/></UI.Flex>;
    case 'result':return name(<UI.Result title="本地导出样本已完成" description="生成了可下载的文本。" tone="success"
      actions={<UI.DownloadButton source="data:text/plain,Peers" filename="peers.txt" label="下载结果"/>}/>);
    case 'skeleton':return <UI.Flex gap={16}><UI.Skeleton lines={4}/><UI.Button actionId="sample.loaded" label={checked?'显示等待样本':'显示已加载内容'} onActivate={()=>setChecked(!checked)}/>{checked&&<UI.Text>已加载内容</UI.Text>}</UI.Flex>;
    case 'spin':return <UI.Flex gap={16}><UI.Spin label="等待 Owner 回读" active={!checked}><UI.Text>已回读</UI.Text></UI.Spin><UI.Button actionId="sample.finish" label="切换等待状态" onActivate={()=>setChecked(!checked)}/></UI.Flex>;
    case 'tag':return <UI.ActionGroup label="标签"><UI.Tag tone="success">已保存</UI.Tag><UI.Tag tone="warning">等待连接</UI.Tag>
      {!checked&&<UI.Tag dismissLabel="删除本地筛选" onDismiss={()=>setChecked(true)}>本地筛选</UI.Tag>}</UI.ActionGroup>;
    case 'toast':return <><UI.Button actionId="sample.toast" label="显示局部反馈" onActivate={()=>channel.publish({id:'sample',message:'草稿仍保留',tone:'info'})}/><UI.ToastHost channel={channel}/></>;
    case 'descriptions':return <UI.Descriptions items={[{id:'name',label:'名称',content:'工作区 A'},{id:'state',label:'连接状态',content:<UI.Tag tone="success">已连接</UI.Tag>},{id:'owner',label:'身份',content:'林'}]}/>;
    case 'hotkey':return <UI.Flex gap={16}><UI.Text>搜索当前工作区</UI.Text><UI.ShortcutHint keys={['⌘','K']} label="Command K"/></UI.Flex>;
    case 'list':return <UI.List items={rows.slice(0,3)} itemKey={row=>row.id} renderItem={row=><UI.ListItem actions={<UI.Button actionId={`sample.open.${row.id}`} label="打开" onActivate={()=>setResult(row.name)}/>}>
      <UI.ListItemMeta avatar={<UI.Avatar name={row.name}/>} title={row.name} description="本地草稿"/></UI.ListItem>}/>;
    case 'markdown':return <UI.Flex gap={16}><UI.TextArea aria-label="Markdown 原文" value={text} onChange={e=>setText(e.target.value)}/><UI.Markdown content={`# 文档\n${text}\n\n- 任务 A\n- 任务 B\n\n<script>alert(1)</script>\n[危险链接](javascript:alert(1))`}/></UI.Flex>;
    case 'statistic':return <UI.Statistic label="本地样本待处理数" value={number} suffix=" 项"/>;
    case 'table':return <UI.DataTable rows={rows} rowKey="id" pageSize={5} columns={[{id:'name',label:'任务',value:'name'},{id:'count',label:'数量',value:'count',compare:(a,b)=>a.count-b.count}]}
      renderExpanded={row=><UI.Text>{row.name} 的本地详情</UI.Text>}/>;
    case 'text':return <UI.Flex gap={16}><UI.Heading level={2}>文档标题</UI.Heading><UI.Text strong>正文强调</UI.Text><UI.Text tone="secondary">次要说明</UI.Text><UI.Paragraph>长文在稳定的阅读轨道中换行。</UI.Paragraph></UI.Flex>;
    case 'calendarview':return name(<UI.CalendarView month={date.slice(0,7)} onMonthChange={month=>setDate(`${month}-01`)} label="任务日历"
      events={[{id:'review',date:'2026-10-28',label:'统一审阅',onActivate:()=>setResult('已打开统一审阅')}]}/>);
    case 'virtuallist':return <UI.VirtualList items={rows} itemKey={row=>row.id} renderItem={row=><UI.ListItem>{row.name}</UI.ListItem>} rowHeight={40} height={200}/>;
    case 'secretvalue':return <UI.SecretValue label="演示凭据" value="demo-only-secret" revealed={checked} onRevealChange={setChecked}/>;
    case 'block':return <UI.Block style={{padding:24,background:'var(--pt-subtle)',borderRadius:'var(--pt-radius-md)'}}><UI.Text>拥有明确阅读边界的 Surface。</UI.Text></UI.Block>;
    case 'divider':return <UI.Flex><UI.Text>当前范围</UI.Text><UI.Divider/><UI.Text>另一信息组</UI.Text></UI.Flex>;
    case 'draggablepanel':return <div style={{height:200,display:'flex'}}><UI.ResizablePanel size={size} onSizeChange={setSize} label="调整文档面板宽度">
      <UI.Text>拖动分隔条或使用方向键。当前宽度 {size}。</UI.Text></UI.ResizablePanel><UI.Block style={{background:'var(--pt-subtle)',flex:1}}>阅读区域</UI.Block></div>;
    case 'flex':return <UI.Flex gap={16}><UI.Flex direction="row" wrap="wrap" gap={12}>{order.map(item=><UI.Tag key={item}>{item}</UI.Tag>)}</UI.Flex><UI.Center style={{height:80,background:'var(--pt-subtle)'}}>居中内容</UI.Center></UI.Flex>;
    case 'grid':return <UI.Grid columns={3} gap={16}>{order.map(item=><UI.Card key={item} heading={item}><UI.Text>等宽阅读列</UI.Text></UI.Card>)}</UI.Grid>;
    case 'header':return name(<UI.PageHeader title="工作区设置" description="修改当前工作区的显示偏好。" actions={<UI.Button actionId="sample.settings.save" label="保存更改" onActivate={()=>setResult('已发送保存意图')}/>}/>);
    case 'layout':return <div style={{height:240}}><UI.Layout header={<UI.Header>工作区 A</UI.Header>} sidebar={<UI.SideNav items={actions.map(a=>({...a,label:a.label}))}/>} footer={<UI.Text>本地状态</UI.Text>}>
      <UI.Card heading="文档内容"><UI.Text>只有中间区域滚动。</UI.Text></UI.Card></UI.Layout></div>;
    case 'maskshadow':return <UI.OverflowHint maxHeight={160}><UI.List items={rows} itemKey={row=>row.id} renderItem={row=><UI.ListItem>{row.name}</UI.ListItem>}/></UI.OverflowHint>;
    case 'progressiveblur':return <UI.SurfaceFade><UI.Paragraph>{'较长内容片段。'.repeat(40)}</UI.Paragraph></UI.SurfaceFade>;
    case 'scrollarea':return <UI.ScrollArea maxHeight={200}><UI.List items={rows} itemKey={row=>row.id} renderItem={row=><UI.ListItem>{row.name}</UI.ListItem>}/></UI.ScrollArea>;
    case 'card':return name(<UI.Card heading="当前草稿" actions={<UI.Button actionId="sample.card.edit" label="编辑草稿" onActivate={()=>setResult('编辑当前草稿')}/>}
      footer={<UI.Text tone="secondary">刚刚修改</UI.Text>}><UI.Paragraph>{text}</UI.Paragraph></UI.Card>);
    case 'accordion':return <UI.Accordion items={[{id:'draft',title:'草稿选项',content:<UI.TextField aria-label="草稿标题" value={text} onChange={e=>setText(e.target.value)}/>},{id:'access',title:'访问范围',content:'本地工作区'}]}/>;
    case 'collapsible':return <UI.Collapsible title="查看同步详情"><UI.Text>本地副本保留，等待连接后重试。</UI.Text></UI.Collapsible>;
    case 'anchor':return <UI.Flex gap={16}><UI.SectionNav label="本页章节" sections={[{id:'ui-gallery-contract',label:'组件合同'},{id:'sample-section',label:'样本章节'}]}/><section id="sample-section"><UI.Heading>样本章节</UI.Heading></section></UI.Flex>;
    case 'breadcrumb':return <UI.Breadcrumb items={[{id:'home',label:'工作区',onActivate:()=>setResult('回到工作区')},{id:'folder',label:'文档',onActivate:()=>setResult('回到文档')},{id:'current',label:'当前草稿'}]}/>;
    case 'burger':return <UI.Flex gap={16}><UI.NavigationToggle open={checked} onOpenChange={setChecked} label={checked?'收起导航':'展开导航'}/>{checked&&<UI.SideNav items={actions}/>}</UI.Flex>;
    case 'draggablesidenav':return <div style={{height:200}}><UI.ResizableNavigationRail size={size} onSizeChange={setSize} resizeLabel="调整导航宽度" items={actions} value={value}/></div>;
    case 'pagination':return <UI.Pagination page={page} total={80} pageSize={10} onPageChange={setPage}/>;
    case 'sidenav':return name(<UI.SideNav items={choices.map(choice=>({id:choice.value,label:choice.label,disabled:choice.availability?.kind==='disabled',
      onActivate:()=>{setValue(choice.value);setResult(`当前工作区 ${choice.value}`);}}))} value={value}/>);
    case 'steps':return <UI.Flex gap={16}><UI.Steps items={order.map((title,i)=>({id:title,title,state:i<number%3?'completed':i===number%3?'current':'pending'}))}/>
      <UI.Button actionId="sample.step.next" label="推进本地样本步骤" onActivate={()=>setNumber(number+1)}/></UI.Flex>;
    case 'tabs':return <UI.Tabs items={[{id:'overview',label:'概览',content:'工作区概览'},{id:'draft',label:'草稿',keepMounted:true,content:<UI.TextField aria-label="保留草稿" value={text} onChange={e=>setText(e.target.value)}/>},
      {id:'unavailable',label:'受限页面',disabled:true,content:'受限'}]}/>;
    case 'tree':return <UI.Tree label="工作区树" nodes={[{id:'local',label:'本地工作区',children:[{id:'docs',label:'文档'},{id:'locked',label:'受限',disabled:true}]}]} selectedId={value} onSelect={setValue}/>;
    case 'commandpalette':return name(<><UI.Button actionId="sample.palette" label="打开命令查找" onActivate={()=>setOpen(true)}/>
      <UI.CommandPalette open={open} onDismiss={()=>setOpen(false)} label="工作区命令" commands={commands} onSelect={setResult}/></>);
    case 'contextmenu':return name(<UI.ContextMenu label="文档命令" actions={actions}><UI.Card heading="当前文档"><UI.Text>右键打开文档命令，或使用下方具名入口。</UI.Text></UI.Card></UI.ContextMenu>);
    case 'dropdownmenu':return name(<UI.Menu label="文档动作" actions={actions}><UI.Button actionId="sample.menu" label="文档动作"/></UI.Menu>);
    case 'popover':return <UI.Popover label="文档详情" content={<UI.Descriptions items={[{id:'name',label:'名称',content:text}]}/>}><UI.Button actionId="sample.popover" label="查看文档详情"/></UI.Popover>;
    case 'tooltip':return <UI.Tooltip label="搜索当前文档"><UI.IconButton actionId="sample.hint" iconId="search" label="搜索当前文档" onActivate={()=>setResult('搜索已激活')}/></UI.Tooltip>;
    case 'modal':return <UI.Flex gap={16}><UI.Button actionId="sample.dialog" label="编辑草稿" onActivate={()=>setOpen(true)}/>
      <UI.Dialog open={open} title="编辑草稿" onDismiss={reason=>setResult(`关闭意图 ${reason}：草稿保留`)}
        footer={<UI.Button actionId="sample.dialog.close" label="保留并关闭" onActivate={()=>setOpen(false)}/>}>
        <UI.Field label="草稿内容"><UI.TextField value={text} onChange={e=>setText(e.target.value)}/></UI.Field>{status}</UI.Dialog><UI.Text>外部草稿：{text}</UI.Text></UI.Flex>;
    case 'drawer':return <><UI.Button actionId="sample.drawer" label="打开详情面板" onActivate={()=>setOpen(true)}/><UI.Drawer open={open} title="工作区详情" onDismiss={()=>setOpen(false)}>
      <UI.Descriptions items={[{id:'name',label:'名称',content:'工作区 A'}]}/></UI.Drawer></>;
    case 'floatingsheet':return <><UI.Button actionId="sample.sheet" label="打开底部任务面板" onActivate={()=>setOpen(true)}/><UI.Sheet open={open} title="附件详情" onDismiss={()=>setOpen(false)}>
      <UI.Text>任务面板关闭不取消后台上传。</UI.Text></UI.Sheet></>;
    case 'floatingpanel':return <><UI.Button actionId="sample.panel" label="打开浮动阅读面板" onActivate={()=>setOpen(true)}/>{open&&<UI.FloatingPanel title="文档阅读" position={position}
      onPositionChange={setPosition} onClose={()=>setOpen(false)}><UI.Text>{text}</UI.Text></UI.FloatingPanel>}</>;
    case 'carousel':return <UI.Carousel label="文档预览" items={order.map((title,i)=>({id:title,label:title,content:<UI.Card heading={title}><UI.Text>预览 {i+1}</UI.Text></UI.Card>}))}/>;
    case 'image':return <UI.Image resource={checked?{...media,state:'unavailable',failureReason:'此身份不可访问图像'}:media} preview previewLabel="放大图书馆照片"/>;
    case 'htmlpreview':return <UI.HtmlPreview label="隔离 HTML 预览" html="<h2>本地文档</h2><p>脚本和外部请求被隔离。</p><script>parent.document.body.textContent='unsafe'</script>"/>;
    case 'qrcode':return <UI.Flex gap={16}><UI.Field label="QR 原文"><UI.TextField value={text} onChange={e=>setText(e.target.value)}/></UI.Field><UI.QrCode label="演示 QR" value={text}/></UI.Flex>;
    case 'video':return <UI.Flex gap={16}><UI.VideoPlayer resource={{resourceId:'video',name:'选择本地视频样本',source:query,state:query?'available':'unavailable'}}
      onPlaybackChange={setResult}/><UI.FilePicker label="选择视频" accept="video/*" onFiles={files=>{if(query)URL.revokeObjectURL(query);if(files[0])setQuery(URL.createObjectURL(files[0]));}}/>{status}</UI.Flex>;
    case 'audioplayer':return <UI.Flex gap={16}><UI.AudioPlayer resource={{resourceId:'audio',name:'选择本地音频样本',source:query,state:query?'available':'unavailable'}}
      onPlaybackChange={setResult}/><UI.FilePicker label="选择音频" accept="audio/*" onFiles={files=>{if(query)URL.revokeObjectURL(query);if(files[0])setQuery(URL.createObjectURL(files[0]));}}/>{status}</UI.Flex>;
    case 'highlighter':return <UI.CodeBlock code={`const draft = ${JSON.stringify(text)};\nconsole.log(draft);`} language="typescript" lineNumbers label="类型脚本样本"/>;
    case 'snippet':return <UI.CodeSnippet code="pnpm --filter @peers-touch/ui check" language="shell" label="检查命令"/>;
    case 'codeeditor':return name(<UI.CodeEditor label="配置草稿" language="json" value={text} onValueChange={setText} onCommit={v=>setResult(`本地保存回读：${v}`)}/>);
    case 'codediff':return <UI.CodeDiff before="version = 1\nname = draft\n" after={`version = 1\nname = ${text}\n`} beforeLabel="已保存" afterLabel="当前草稿"/>;
    case 'mermaid':return <UI.Flex gap={16}><UI.Button actionId="sample.diagram.invalid" label={checked?'显示正常图':'测试语法失败'} onActivate={()=>setChecked(!checked)}/>
      <UI.DiagramPreview label="草稿生命周期" source={checked?'invalid syntax !!!':'flowchart LR\n A[编辑] --> B[确认] --> C[回读]'}/></UI.Flex>;
    case 'configprovider':return <UI.UIProvider theme={checked?'dark':'light'}><UI.Flex gap={16}><UI.Text>局部主题边界</UI.Text><UI.Button actionId="sample.theme" label="切换局部主题" onActivate={()=>setChecked(!checked)}/></UI.Flex></UI.UIProvider>;
    case 'focusscope':return <UI.Flex gap={16}><UI.Button actionId="sample.scope" label={checked?'解除焦点边界':'启用焦点边界'} onActivate={()=>setChecked(!checked)}/>
      <UI.FocusBoundary active={checked}><UI.TextField aria-label="边界内输入"/><UI.Button actionId="sample.scope.release" label="解除边界" onActivate={()=>setChecked(false)}/></UI.FocusBoundary></UI.Flex>;
    case 'fontloader':return name(<UI.FontAssets assets={checked?[{id:'invalid-demo',family:'GalleryInvalid',source:'data:font/woff2,invalid',license:'synthetic invalid test fixture'}]:[]}
      onFailure={()=>setResult('字体失败回退到系统字体')}><UI.Text>系统字体仍可阅读。</UI.Text><UI.Button actionId="sample.font" label="测试字体加载失败" onActivate={()=>setChecked(true)}/></UI.FontAssets>);
    case 'freeze':return <UI.Flex gap={16}><UI.Button actionId="sample.suspend" label={checked?'恢复面板':'暂停隐藏面板'} onActivate={()=>setChecked(!checked)}/>
      <UI.RenderSuspension active={!checked}><UI.TextField aria-label="暂停前草稿" defaultValue="隐藏后仍保留"/></UI.RenderSuspension></UI.Flex>;
    case 'motionprovider':return <UI.MotionPolicy preference={checked?'reduced':'full'}><UI.Flex gap={16}><UI.Spin label="动效偏好"/>
      <UI.Button actionId="sample.motion" label={checked?'使用完整动效':'减少动效'} onActivate={()=>setChecked(!checked)}/></UI.Flex></UI.MotionPolicy>;
    case 'react-error-boundary':return <UI.Flex gap={16}><UI.Button actionId="sample.error" label="注入视图失败" onActivate={()=>setChecked(true)}/>
      <UI.Button actionId="sample.error.reset" label="恢复输入上下文" onActivate={()=>{setChecked(false);setNumber(number+1);}}/>
      <UI.ViewErrorBoundary label="当前视图无法显示，草稿未丢失" resetKey={String(number)}><ThrowingView fail={checked}/></UI.ViewErrorBoundary></UI.Flex>;
    case 'styles':return <UI.UIProvider theme={checked?'dark':'light'}><UI.Flex gap={16}><UI.Card heading="共享 Token 边界"><UI.Text>颜色、圆角、间距与焦点来自统一变量。</UI.Text></UI.Card>
      <UI.Button actionId="sample.tokens" label="切换主题变量" onActivate={()=>setChecked(!checked)}/></UI.Flex></UI.UIProvider>;
    default:throw new Error(`No primitive specimen registered for ${id}`);
  }
}
function ThrowingView({fail}:{fail:boolean}) {if(fail)throw new Error('Intentional gallery view failure');return <UI.Text>视图正常</UI.Text>;}
