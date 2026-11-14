import { useId, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { nextEnabledIndex } from '@peers-touch/ui-semantics';
import { Button, Link } from './actions';
import { Icon } from './icon';

export interface TabItem { id: string; label: ReactNode; content: ReactNode; disabled?: boolean; keepMounted?: boolean }
export interface TabsProps extends HTMLAttributes<HTMLDivElement> {
  items: readonly TabItem[]; value?: string; defaultValue?: string; onValueChange?: (value: string) => void;
  /** App-owned class merged onto each rendered tab panel (layout). */
  panelClassName?: string;
}
export function Tabs({ items, value: supplied, defaultValue, onValueChange, className = '', panelClassName = '', ...props }: TabsProps) {
  const [local, setLocal] = useState(defaultValue ?? items[0]?.id), value = supplied ?? local;
  const [visited, setVisited] = useState(() => new Set([supplied ?? defaultValue ?? items[0]?.id]));
  const list = useRef<HTMLDivElement>(null), id = useId();
  const select = (next: string) => { setVisited(old=>new Set([...old,next])); setLocal(next); onValueChange?.(next); };
  return <div {...props} className={`pt-tabs ${className}`}>
    <div className="pt-tab-list" ref={list} role="tablist" onKeyDown={event => {
      if (!['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const current = items.findIndex(item => item.id === value);
      const next = event.key === 'Home' ? nextEnabledIndex(-1,1,items.length,i=>!!items[i].disabled)
        : event.key === 'End' ? nextEnabledIndex(0,-1,items.length,i=>!!items[i].disabled)
          : nextEnabledIndex(current,event.key === 'ArrowRight' ? 1 : -1,items.length,i=>!!items[i].disabled);
      if (next >= 0) { select(items[next].id); list.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next]?.focus(); }
    }}>
      {items.map(item => <button className="pt-tab" key={item.id} type="button" role="tab"
        id={`${id}-tab-${item.id}`} aria-controls={`${id}-panel-${item.id}`}
        aria-selected={value === item.id} tabIndex={value === item.id ? 0 : -1} disabled={item.disabled}
        onClick={() => select(item.id)}>{item.label}</button>)}
    </div>
    {items.filter(item => value === item.id || item.keepMounted && visited.has(item.id)).map(item => <div key={item.id} className={`pt-tab-panel ${panelClassName}`}
      id={`${id}-panel-${item.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${item.id}`} hidden={value !== item.id}>{item.content}</div>)}
  </div>;
}
export interface AccordionItem { id: string; title: ReactNode; content: ReactNode; keepMounted?: boolean }
export interface AccordionProps extends HTMLAttributes<HTMLDivElement> {
  items: readonly AccordionItem[]; expanded?: readonly string[]; onExpandedChange?: (ids: string[]) => void;
  defaultExpanded?: readonly string[];
}
export function Accordion({ items, expanded, defaultExpanded = [], onExpandedChange, ...props }: AccordionProps) {
  const [local, setLocal] = useState<string[]>([...defaultExpanded]), active = expanded ?? local;
  return <div {...props}>{items.map(item => <details key={item.id} open={active.includes(item.id)}
    onToggle={event => {
      const next = event.currentTarget.open ? [...active.filter(id=>id!==item.id),item.id] : active.filter(id=>id!==item.id);
      if (next.join() !== active.join()) { setLocal(next); onExpandedChange?.(next); }
    }}><summary>{item.title}</summary>{active.includes(item.id)||item.keepMounted ? item.content : null}</details>)}</div>;
}
export function Collapsible({ title, children }: { title: ReactNode; children: ReactNode }) {
  return <details><summary>{title}</summary>{children}</details>;
}
export interface BreadcrumbItem { id: string; label: ReactNode; href?: string; onActivate?: () => void }
export function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }) {
  return <nav aria-label="Breadcrumb"><ol style={{ display:'flex',gap:'var(--pt-space-xs)',listStyle:'none',padding:0 }}>
    {items.map((item,i) => <li key={item.id}>{i>0 && <span aria-hidden="true"> / </span>}
      {i===items.length-1 ? <span aria-current="page">{item.label}</span> : item.href ? <Link href={item.href}>{item.label}</Link>
        : <Button actionId={item.id} emphasis="inline" onActivate={item.onActivate}>{item.label}</Button>}</li>)}
  </ol></nav>;
}
export interface StepItem { id: string; title: ReactNode; description?: ReactNode; state: 'pending' | 'current' | 'completed' | 'failed' }
export function Steps({ items }: { items: readonly StepItem[] }) {
  return <ol style={{ display:'flex',gap:'var(--pt-space-md)',listStyle:'none',padding:0 }}>
    {items.map((item,i) => <li key={item.id} aria-current={item.state==='current' ? 'step' : undefined}>
      <div><span aria-label={item.state}>{item.state==='completed' ? <Icon iconId="check" /> : i+1}</span> {item.title}</div>
      {item.description && <div className="pt-list-description">{item.description}</div>}</li>)}
  </ol>;
}
export interface NavItem { id: string; label: ReactNode; icon?: ReactNode; onActivate: () => void; disabled?: boolean }
export interface SideNavProps extends HTMLAttributes<HTMLElement> {
  items: readonly NavItem[]; value?: string; header?: ReactNode; footer?: ReactNode;
}
export function SideNav({ items, value, header, footer, children, style, ...props }: SideNavProps) {
  return <nav {...props} style={{ display:'flex',flexDirection:'column',gap:'var(--pt-space-xs)',...style }}>
    {header}{items.map(item => <Button key={item.id} actionId={item.id} emphasis="quiet" aria-current={value===item.id ? 'page' : undefined}
      availability={item.disabled ? {kind:'disabled',reason:'Unavailable'} : undefined} leading={item.icon} onActivate={item.onActivate}>{item.label}</Button>)}{children}{footer}
  </nav>;
}
export interface TreeNode { id: string; label: ReactNode; children?: readonly TreeNode[]; disabled?: boolean }
export interface TreeProps { nodes: readonly TreeNode[]; selectedId?: string; onSelect?: (id: string) => void; label: string }
export function Tree({ nodes, selectedId, onSelect, label }: TreeProps) {
  const [expanded, setExpanded] = useState(new Set<string>()), [active, setActive] = useState(nodes[0]?.id);
  const root = useRef<HTMLDivElement>(null), visible: {node:TreeNode;parent?:string}[] = [];
  const collect = (items:readonly TreeNode[],parent?:string) => { for(const node of items) { visible.push({node,parent}); if(expanded.has(node.id)) collect(node.children??[],node.id); } };
  collect(nodes);
  const focus = (id:string) => { setActive(id); [...(root.current?.querySelectorAll<HTMLElement>('[role=treeitem]')??[])].find(n=>n.dataset.nodeId===id)?.focus(); };
  const render = (items:readonly TreeNode[],level:number):ReactNode => items.map(node => <div key={node.id}>
    <div role="treeitem" tabIndex={active===node.id ? 0 : -1} data-node-id={node.id} aria-level={level}
      aria-selected={selectedId===node.id} aria-expanded={node.children?.length ? expanded.has(node.id) : undefined}
      aria-disabled={node.disabled || undefined} style={{paddingInlineStart:(level-1)*16,minHeight:32}}
      onClick={() => { if(!node.disabled) { setActive(node.id); onSelect?.(node.id); } }}
      onKeyDown={event => {
        const index=visible.findIndex(v=>v.node.id===node.id);
        if(event.key==='ArrowDown'||event.key==='ArrowUp') {
          event.preventDefault(); const next=nextEnabledIndex(index,event.key==='ArrowDown'?1:-1,visible.length,i=>!!visible[i].node.disabled);
          if(next>=0) focus(visible[next].node.id);
        } else if(event.key==='ArrowRight'&&node.children?.length) {
          event.preventDefault(); if(expanded.has(node.id)) focus(node.children[0].id); else setExpanded(old=>new Set([...old,node.id]));
        } else if(event.key==='ArrowLeft') {
          event.preventDefault(); if(expanded.has(node.id)) setExpanded(old=>new Set([...old].filter(id=>id!==node.id)));
          else if(visible[index].parent) focus(visible[index].parent!);
        } else if(event.key==='Enter'||event.key===' ') { event.preventDefault(); if(!node.disabled) onSelect?.(node.id); }
      }}>{node.children?.length ? <Icon iconId={expanded.has(node.id)?'chevron-down':'chevron-right'} size={14}/> : null}{node.label}</div>
    {expanded.has(node.id)&&node.children?.length ? <div role="group">{render(node.children,level+1)}</div> : null}
  </div>);
  return <div ref={root} role="tree" aria-label={label}>{render(nodes,1)}</div>;
}
