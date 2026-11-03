import { useEffect, useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { MenuAction } from '@peers-touch/ui-contracts';
import { ActionGroup, Button } from './actions';
import { asActionTone } from '@peers-touch/ui-semantics';
import { Card, Flex, ScrollArea } from './layout';
import { SideNav, type SideNavProps } from './navigation';
import { Dialog, Drawer, Popover, type DrawerProps } from './overlays';
import { CommandPicker, type CommandPickerProps } from './advanced-fields';
import { TextField } from './fields';

export function OverflowToolbar({actions,visibleCount=3,label}: {actions:readonly MenuAction[];visibleCount?:number;label:string}) {
  const shown=actions.slice(0,Math.max(0,visibleCount)), overflow=actions.slice(shown.length);
  return <ActionGroup label={label}>{shown.map(action=><Button key={action.id} actionId={action.id} label={action.label}
    tone={asActionTone(action.tone)} availability={action.availability} onActivate={action.onActivate}/>)}
    {overflow.length>0&&<Popover label="Additional actions" content={<Flex gap={4}>{overflow.map(action=><Button key={action.id}
      actionId={action.id} label={action.label} tone={asActionTone(action.tone)} availability={action.availability} onActivate={action.onActivate}/>)}</Flex>}>
      <Button actionId="toolbar.more" label="More actions"/></Popover>}</ActionGroup>;
}
export interface ResizablePanelProps extends HTMLAttributes<HTMLDivElement> {
  size?:number;defaultSize?:number;onSizeChange?:(size:number)=>void;minimum?:number;maximum?:number;axis?:'horizontal'|'vertical';label:string;open?:boolean;
}
export function ResizablePanel({size:supplied,defaultSize=320,onSizeChange:onChange,minimum=180,maximum=600,axis='horizontal',label,children,style,open=true,...props}:ResizablePanelProps) {
  const [local,setLocal]=useState(defaultSize),size=supplied??local;
  const onSizeChange=(next:number)=>{setLocal(next);onChange?.(next);};
  const dragging=useRef<{id:number;position:number;size:number}|null>(null), root=useRef<HTMLDivElement>(null), id=useId();
  const clamp=(next:number)=>Math.min(maximum,Math.max(minimum,next));
  useEffect(()=>()=>{dragging.current=null;},[]);
  return <div {...props} ref={root} className={`pt-resizable ${props.className??''}`}
    hidden={!open} style={{...(axis==='horizontal'?{width:clamp(size),height:'100%'}:{height:clamp(size),width:'100%'}),...style}}>
    <div id={id} className="pt-resizable-body">{children}</div>
    <div role="separator" tabIndex={0} aria-label={label} aria-controls={id} aria-orientation={axis==='horizontal'?'vertical':'horizontal'}
      aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={clamp(size)} className="pt-resize-handle" data-axis={axis}
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);dragging.current={id:e.pointerId,position:axis==='horizontal'?e.clientX:e.clientY,size};}}
      onPointerMove={e=>{const active=dragging.current;if(active?.id!==e.pointerId)return;onSizeChange(clamp(active.size+(axis==='horizontal'?e.clientX:e.clientY)-active.position));}}
      onPointerUp={e=>{if(dragging.current?.id===e.pointerId){dragging.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}}}
      onPointerCancel={()=>{dragging.current=null;}} onLostPointerCapture={()=>{dragging.current=null;}}
      onKeyDown={e=>{
        const backwards=axis==='horizontal'?'ArrowLeft':'ArrowUp', forwards=axis==='horizontal'?'ArrowRight':'ArrowDown';
        if(![backwards,forwards,'Home','End'].includes(e.key))return;e.preventDefault();
        onSizeChange(e.key==='Home'?minimum:e.key==='End'?maximum:clamp(size+(e.key===forwards?1:-1)*(e.shiftKey?40:10)));
      }}/></div>;
}
export function ResizableNavigationRail({size,onSizeChange,resizeLabel,minimum,maximum,...props}:SideNavProps&{size:number;onSizeChange:(size:number)=>void;resizeLabel:string;minimum?:number;maximum?:number}) {
  return <ResizablePanel size={size} onSizeChange={onSizeChange} label={resizeLabel} minimum={minimum} maximum={maximum}><SideNav {...props}/></ResizablePanel>;
}
export function OverflowHint({children,maxHeight=160,...props}:HTMLAttributes<HTMLDivElement>&{maxHeight?:number|string}) {
  const root=useRef<HTMLDivElement>(null),[edges,setEdges]=useState({start:false,end:false});
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const measure=()=>setEdges({start:element.scrollTop>1,end:element.scrollTop+element.clientHeight<element.scrollHeight-1});
    const observer=new ResizeObserver(measure);observer.observe(element);if(element.firstElementChild)observer.observe(element.firstElementChild);
    const mutation=new MutationObserver(measure);mutation.observe(element,{childList:true,subtree:true,characterData:true});
    element.addEventListener('scroll',measure,{passive:true});measure();
    return()=>{observer.disconnect();mutation.disconnect();element.removeEventListener('scroll',measure);};
  },[]);
  return <div className="pt-overflow-hint" data-start={edges.start||undefined} data-end={edges.end||undefined}>
    <ScrollArea {...props} ref={root} maxHeight={maxHeight}>{children}</ScrollArea></div>;
}
export function SurfaceFade({children,...props}:HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`pt-surface-fade ${props.className??''}`}>{children}</div>;
}
export function PageHeader({title,description,actions,...props}:Omit<HTMLAttributes<HTMLElement>,'title'>&{title:ReactNode;description?:ReactNode;actions?:ReactNode}) {
  return <header {...props} className={`pt-page-header ${props.className??''}`}><div><h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions}</header>;
}
export function SectionNav({sections,label}: {sections:readonly {id:string;label:string}[];label:string}) {
  return <nav aria-label={label}><ol className="pt-list">{sections.map(section=><li key={section.id}><a className="pt-link" href={`#${encodeURIComponent(section.id)}`}>{section.label}</a></li>)}</ol></nav>;
}
export function NavigationToggle({open,onOpenChange,label}: {open:boolean;onOpenChange:(open:boolean)=>void;label:string}) {
  return <Button actionId="navigation.toggle" label={label} aria-expanded={open} onActivate={()=>onOpenChange(!open)}/>;
}
export function Sheet(props:DrawerProps){return <Drawer {...props} side="bottom"/>;}
export function FloatingPanel({title,children,position,onPositionChange,onClose,closeLabel='Close'}:{
  title:string;children:ReactNode;position:{x:number;y:number};onPositionChange:(position:{x:number;y:number})=>void;onClose:()=>void;closeLabel?:string;
}) {
  const drag=useRef<{id:number;dx:number;dy:number}|null>(null);
  return <Card heading={<span>{title}</span>} actions={<Button actionId="panel.close" label={closeLabel} onActivate={onClose}/>}
    style={{position:'fixed',left:position.x,top:position.y,zIndex:20,maxWidth:'calc(100vw - 32px)',width:320}}>
    <div role="group" aria-label={`Move ${title}`} tabIndex={0} className="pt-panel-grip"
      onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,dx:e.clientX-position.x,dy:e.clientY-position.y};}}
      onPointerMove={e=>{const active=drag.current;if(active?.id===e.pointerId)onPositionChange({x:Math.max(0,Math.min(window.innerWidth-64,e.clientX-active.dx)),y:Math.max(0,Math.min(window.innerHeight-64,e.clientY-active.dy))});}}
      onPointerUp={e=>{drag.current=null;e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{drag.current=null;}}
      onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();onPositionChange({x:Math.max(0,position.x+(e.key==='ArrowRight'?10:e.key==='ArrowLeft'?-10:0)),
        y:Math.max(0,position.y+(e.key==='ArrowDown'?10:e.key==='ArrowUp'?-10:0))});}}>Move panel</div>{children}</Card>;
}
export function CommandPalette({open,onDismiss,...props}:CommandPickerProps&{open:boolean;onDismiss:()=>void}) {
  return <Dialog open={open} onDismiss={onDismiss} title={props.label}><CommandPicker {...props} onSelect={id=>{onDismiss();props.onSelect(id);}}/></Dialog>;
}
export interface CalendarEvent {id:string;date:string;label:string;onActivate?:()=>void;}
export function CalendarView({month,events,label,onMonthChange,previousMonthLabel='Previous month',nextMonthLabel='Next month',invalidMonthLabel='Invalid calendar month'}: {month:string;events:readonly CalendarEvent[];label:string;onMonthChange:(month:string)=>void;previousMonthLabel?:string;nextMonthLabel?:string;invalidMonthLabel?:string}) {
  const parsed=/^(\d{4})-(\d{2})$/.exec(month);
  if(!parsed)return <div role="alert">{invalidMonthLabel}</div>;
  const year=Number(parsed[1]),index=Number(parsed[2])-1;
  if(index<0||index>11)return <div role="alert">{invalidMonthLabel}</div>;
  const days=new Date(year,index+1,0).getDate(),start=(new Date(year,index,1).getDay()+6)%7;
  const change=(offset:number)=>{const next=new Date(year,index+offset,1);onMonthChange(`${next.getFullYear()}-${String(next.getMonth()+1).padStart(2,'0')}`);};
  return <section aria-label={label}><ActionGroup label="Calendar navigation"><Button actionId="calendar.previous" label={previousMonthLabel} onActivate={()=>change(-1)}/>
    <TextField aria-label="Month" type="month" value={month} onChange={e=>onMonthChange(e.target.value)}/>
    <Button actionId="calendar.next" label={nextMonthLabel} onActivate={()=>change(1)}/></ActionGroup>
    <div className="pt-calendar">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=><div key={day}>{day}</div>)}
      {Array.from({length:start},(_,i)=><div key={`blank-${i}`}/>)}
      {Array.from({length:days},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`;return <div key={date} className="pt-calendar-day">
        <time dateTime={date}>{i+1}</time>{events.filter(event=>event.date===date).map(event=><Button key={event.id} actionId={`calendar.${event.id}`}
          label={event.label} emphasis="quiet" density="compact" onActivate={event.onActivate}/>)}</div>;})}</div></section>;
}
