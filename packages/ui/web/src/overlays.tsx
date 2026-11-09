import {
  Children, cloneElement, forwardRef, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { DismissReason, MenuAction, OverlayPlacement } from '@peers-touch/ui-contracts';
import { nextEnabledIndex, asActionTone } from '@peers-touch/ui-semantics';
import { useOverlayHost } from './provider';

/** Re-exported so consumers can type menu action arrays from the package entry
 *  without taking a direct dependency on @peers-touch/ui-contracts. */
export type { MenuAction } from '@peers-touch/ui-contracts';
import { Button, IconButton } from './actions';
import { Icon } from './icon';

const focusable = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';
/** Floating layers must stay inside the app surface that clips their anchor.
 * Viewport clamping alone lets a menu escape a rounded overflow:hidden app
 * frame and paint over the outer page; the nearest hidden/clip ancestor is
 * the real boundary (the prototype frame in specimens, the window in
 * production where the walk reaches <html> and yields no tighter rect). */
function nearestClipFrame(anchor: HTMLElement, win: Window): DOMRect | null {
  let node: HTMLElement | null = anchor.parentElement;
  const { body, documentElement } = win.document;
  while (node && node !== body && node !== documentElement) {
    const style = win.getComputedStyle(node);
    if (style.overflowX === 'hidden' || style.overflowX === 'clip'
      || style.overflowY === 'hidden' || style.overflowY === 'clip') {
      return node.getBoundingClientRect();
    }
    node = node.parentElement;
  }
  return null;
}
interface OverlayLayerProps {
  children: ReactNode;
  open: boolean;
  kind: 'tooltip' | 'popover' | 'menu' | 'dialog' | 'drawer';
  anchor?: HTMLElement | null;
  anchorPoint?: {x:number;y:number};
  placement?: OverlayPlacement;
  inputMode?: 'pointer' | 'keyboard';
  onDismiss: (reason: DismissReason) => void;
  label?: string;
  labelledBy?: string;
  describedBy?: string;
  className?: string;
  style?: CSSProperties;
  dismissOutside?: boolean;
}
function OverlayLayer({
  children, open, kind, anchor, anchorPoint, placement = 'bottom', inputMode = 'keyboard', onDismiss,
  label, labelledBy, describedBy, className = '', style, dismissOutside = true,
}: OverlayLayerProps) {
  const host = useOverlayHost();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const modal = kind === 'dialog' || kind === 'drawer';
  const [position, setPosition] = useState<CSSProperties>({});
  useLayoutEffect(() => {
    if (!open || !host.element) return;
    const doc = host.element.ownerDocument;
    const win = doc.defaultView!;
    const previous = anchor ?? host.focusOrigin() ?? (doc.activeElement instanceof win.HTMLElement ? doc.activeElement : null);
    const unregister = kind === 'tooltip' ? () => {} : host.register({ id, modal });
    const positionPopup = () => {
      if (!anchor || !root.current || modal) return;
      if (!anchor.isConnected) { dismiss.current('outside'); return; }
      const a = anchorPoint ? {left:anchorPoint.x,right:anchorPoint.x,top:anchorPoint.y,bottom:anchorPoint.y} : anchor.getBoundingClientRect();
      const r = root.current.getBoundingClientRect(), gap = 4;
      let left = a.left, top = a.bottom + gap;
      const edgeBottom = placement.endsWith('-bottom');
      if (placement === 'top') top = a.top - r.height - gap;
      if (placement === 'left' || placement === 'left-bottom') {
        left = a.left - r.width - gap;
        top = edgeBottom ? a.bottom - r.height : a.top;
      }
      if (placement === 'right' || placement === 'right-bottom') {
        left = a.right + gap;
        top = edgeBottom ? a.bottom - r.height : a.top;
      }
      // Keep inside the anchor's clipping frame (or the viewport when the
      // app surface is the full window). Side panels only flip above the
      // trigger for the start-aligned variants; bottom-aligned ones clamp
      // toward the gap so they share the owner's bottom edge.
      const clip = nearestClipFrame(anchor, win);
      const minLeft = clip ? Math.max(gap, clip.left + gap) : gap;
      const maxLeft = clip ? Math.min(win.innerWidth - r.width - gap, clip.right - r.width - gap)
        : win.innerWidth - r.width - gap;
      const maxTop = clip ? Math.min(win.innerHeight - r.height - gap, clip.bottom - r.height - gap)
        : win.innerHeight - r.height - gap;
      // Viewport wins over the clip frame vertically. The frame is a scroll
      // container (e.g. the message stream) whose box can extend past the
      // visible area and whose top can sit below the only space the popup
      // fits in; the fixed popup is portaled out of that container, so it is
      // not actually clipped by it. Flip above the trigger when opening below
      // would leave the viewport, even if that crosses the frame top.
      const viewMinTop = gap;
      const viewMaxTop = win.innerHeight - r.height - gap;
      if (top > viewMaxTop) {
        const above = a.top - r.height - gap;
        if (!edgeBottom && above >= viewMinTop) top = above;
        else top = Math.max(viewMinTop, Math.min(maxTop, viewMaxTop));
      }
      if (top < viewMinTop) top = viewMinTop;
      const finalTop = Math.max(viewMinTop, Math.min(top, viewMaxTop));
      setPosition({
        left: Math.max(minLeft, Math.min(left, maxLeft)),
        top: finalTop,
        maxHeight: win.innerHeight - gap * 2 - finalTop,
      });
    };
    positionPopup();
    const observer = new ResizeObserver(positionPopup);
    if (anchor) observer.observe(anchor);
    if (root.current) observer.observe(root.current);
    win.addEventListener('resize', positionPopup);
    doc.addEventListener('scroll', positionPopup, true);
    if (kind !== 'tooltip' && (modal || inputMode === 'keyboard')) {
      (root.current?.querySelector<HTMLElement>('[autofocus]') ??
        (modal ? root.current?.querySelector<HTMLElement>('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') : null) ??
        root.current?.querySelector<HTMLElement>(focusable) ?? root.current)?.focus();
    }
    const keydown = (event: KeyboardEvent) => {
      if (!host.isTop(id) || kind === 'tooltip') return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss.current('escape'); }
      if (event.key === 'Tab' && modal && root.current) {
        const nodes = [...root.current.querySelectorAll<HTMLElement>(focusable)]
          .filter(node => node.getClientRects().length && node.tabIndex >= 0);
        const first = nodes[0], last = nodes[nodes.length-1];
        if (!first) { event.preventDefault(); root.current.focus(); return; }
        if (event.shiftKey && (doc.activeElement === first || doc.activeElement === root.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && doc.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    const pointerdown = (event: PointerEvent) => {
      if (!host.isTop(id) || !dismissOutside || modal || kind === 'tooltip') return;
      const target = event.target as Node;
      if (!root.current?.contains(target) && !anchor?.contains(target)) dismiss.current('outside');
    };
    doc.addEventListener('keydown', keydown, true);
    doc.addEventListener('pointerdown', pointerdown, true);
    return () => {
      unregister(); observer.disconnect();
      win.removeEventListener('resize', positionPopup);
      doc.removeEventListener('scroll', positionPopup, true);
      doc.removeEventListener('keydown', keydown, true);
      doc.removeEventListener('pointerdown', pointerdown, true);
      if (kind !== 'tooltip' && previous?.isConnected && (modal || inputMode === 'keyboard')) host.restoreFocus(previous);
    };
  }, [open, host, id, modal, anchor, anchorPoint, placement, kind, inputMode, dismissOutside]);
  if (!open || !host.element) return null;
  const content = <div ref={root} id={id} className={`pt-overlay pt-${kind} ${className}`}
    data-placement={placement}
    role={modal ? 'dialog' : kind === 'menu' ? 'menu' : kind === 'tooltip' ? 'tooltip' : undefined}
    aria-modal={modal || undefined} aria-label={label} aria-labelledby={labelledBy} aria-describedby={describedBy}
    tabIndex={kind === 'tooltip' ? undefined : -1} style={{ ...position, ...style }}>{children}</div>;
  return createPortal(modal ? <div className={`pt-modal-layer pt-${kind}-layer`}
    onPointerDown={event => {
      if (event.target === event.currentTarget && dismissOutside && host.isTop(id)) dismiss.current('outside');
    }}>{content}</div> : content, host.element);
}
interface TriggerEvents extends HTMLAttributes<HTMLElement> {
  ref?: (node: HTMLElement | null) => void;
  onActivate?: React.MouseEventHandler<HTMLElement>;
}
function useTrigger(children: ReactNode, open: boolean, toggle: (value: boolean) => void, kind: 'menu' | 'popover') {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const mode = useRef<'pointer' | 'keyboard'>('pointer');
  const child = Children.only(children);
  if (!isValidElement<TriggerEvents>(child)) throw new Error('Overlay requires one semantic trigger.');
  const activate: React.MouseEventHandler<HTMLElement> = event => {
      (child.props.onActivate ?? child.props.onClick)?.(event);
      if (event.defaultPrevented) return;
      mode.current = event.detail === 0 ? 'keyboard' : 'pointer';
      if (mode.current === 'pointer') event.currentTarget.blur();
      toggle(!open);
  };
  const trigger = cloneElement(child as ReactElement<TriggerEvents>, {
    ref: setAnchor, 'aria-expanded': open, 'aria-haspopup': child.props['aria-haspopup'] ?? (kind === 'menu' ? 'menu' : 'dialog'),
    onClick: activate, ...(child.props.onActivate ? {onActivate:activate} : {}),
    onKeyDown: event => {
      child.props.onKeyDown?.(event);
      if (!event.defaultPrevented && event.key === 'ArrowDown') {
        event.preventDefault(); mode.current = 'keyboard'; toggle(true);
      }
    },
  });
  return { trigger, anchor, inputMode: mode.current };
}
export interface PopoverProps {
  children: ReactNode; content: ReactNode;
  open?: boolean; onOpenChange?: (open: boolean) => void; placement?: OverlayPlacement;
  label?: string; className?: string;
}
export function Popover({ children, content, open: controlled, onOpenChange, placement, label, className }: PopoverProps) {
  const [local, setLocal] = useState(false), open = controlled ?? local;
  const toggle = (value: boolean) => { setLocal(value); onOpenChange?.(value); };
  const { trigger, anchor, inputMode } = useTrigger(children, open, toggle, 'popover');
  return <>{trigger}<OverlayLayer open={open} kind="popover" anchor={anchor} placement={placement}
    inputMode={inputMode} label={label} className={className} onDismiss={() => toggle(false)}>{content}</OverlayLayer></>;
}
export interface MenuEntry extends Omit<MenuAction,'label'|'onActivate'> {
  label: ReactNode; leading?: ReactNode; kind?: 'action'|'separator';
  onActivate?: (event: React.MouseEvent<HTMLElement>) => void; children?: readonly MenuEntry[];
}
export interface MenuProps extends Omit<PopoverProps, 'content'> {
  actions: readonly MenuEntry[]; anchorPoint?: {x:number;y:number};
  onAction?: (id:string,event:React.MouseEvent<HTMLElement>)=>void;
  contentFrame?:(content:ReactNode)=>ReactNode;
}
export function Menu({ actions, ...props }: MenuProps) {
  const flatten=(entries:readonly MenuEntry[]):MenuEntry[]=>entries.flatMap(entry=>entry.children ? [
    {...entry,kind:'separator' as const},...flatten(entry.children)
  ] : [entry]);
  const entries=flatten(actions), commands=entries.filter(entry=>entry.kind!=='separator');
  const [localOpen, setLocalOpen] = useState(false);
  const open = props.open ?? localOpen;
  const toggle = (value: boolean) => { setLocalOpen(value); props.onOpenChange?.(value); };
  const { trigger, anchor, inputMode } = useTrigger(props.children, open, toggle, 'menu');
  const host = useOverlayHost();
  const close = (restore: boolean) => {
    toggle(false);
    if (restore && anchor) host.restoreFocus(anchor);
  };
  const [active, setActive] = useState(0);
  const menu = useRef<HTMLDivElement>(null);
  const focus = (index: number) => { setActive(index); menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')[index]?.focus(); };
  useEffect(() => { if (open) setActive(nextEnabledIndex(-1, 1, commands.length, i => commands[i].availability?.kind === 'disabled')); }, [open, actions]);
  return <>{trigger}<OverlayLayer open={open} kind="menu" anchor={anchor} inputMode={inputMode}
    placement={props.placement} anchorPoint={props.anchorPoint} label={props.label} onDismiss={reason => close(reason !== 'outside')}>
    {(() => {const content=<div ref={menu} onKeyDown={event => {
      let index = active;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp')
        index = nextEnabledIndex(active, event.key === 'ArrowDown' ? 1 : -1, commands.length, i => commands[i].availability?.kind === 'disabled');
      else if (event.key === 'Home') index = nextEnabledIndex(-1, 1, commands.length, i => commands[i].availability?.kind === 'disabled');
      else if (event.key === 'End') index = nextEnabledIndex(0, -1, commands.length, i => commands[i].availability?.kind === 'disabled');
      else return;
      event.preventDefault(); focus(index);
    }}>
      {entries.map(action => action.kind==='separator' ? <div key={action.id} role="separator" className="pt-menu-separator">{action.label}</div> : <Button key={action.id} actionId={action.id}
        role="menuitem" tabIndex={commands.indexOf(action) === active ? 0 : -1} emphasis="quiet"
        tone={asActionTone(action.tone)}
        availability={action.availability} className="pt-menu-item"
        leading={action.leading ?? (action.iconId ? <Icon iconId={action.iconId as never} /> : undefined)}
        onActivate={event => { close(true); action.onActivate?.(event); props.onAction?.(action.id,event); }}>{action.label}</Button>)}
    </div>;return props.contentFrame?props.contentFrame(content):content;})()}
  </OverlayLayer></>;
}
export function ContextMenu({children,actions,label,onOpenChange}: {children:ReactNode;actions:readonly MenuAction[];label:string;onOpenChange?:(open:boolean)=>void}) {
  const [open,setOpen]=useState(false),[point,setPoint]=useState<{x:number;y:number}|undefined>();
  const show=(next:boolean)=>{ setOpen(next); if(!next) setPoint(undefined); onOpenChange?.(next); };
  return <div className="pt-context-menu" onContextMenu={event=>{event.preventDefault();setPoint({x:event.clientX,y:event.clientY});show(true);}}>
    {children}<Menu label={label} actions={actions} open={open} anchorPoint={point} onOpenChange={show}>
      <Button actionId="context-menu.open" label={label} emphasis="quiet" className="pt-sr-only"
        aria-hidden tabIndex={-1} onPointerDown={()=>setPoint(undefined)}/>
    </Menu></div>;
}
export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode; placement?: OverlayPlacement;
}
// Popover/Menu inject an anchor ref and activation props onto their single
// trigger child. Tooltip must forward that contract to its anchor span —
// otherwise Popover > Tooltip > control compositions render a control whose
// only open path is silently dropped (the trigger child never receives the
// injected onClick and the panel has no anchor). Mirrors Badge's spread.
export const Tooltip = forwardRef<HTMLSpanElement, TooltipProps>(function Tooltip(
  { children, label, placement, className, onFocus, onBlur, onClick, onKeyDown, ...props },
  forwardedRef,
) {
  const [open, setOpen] = useState(false), [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return <span {...props}
    ref={(node) => {
      setAnchor(node);
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
    className={`pt-tooltip-trigger${className ? ` ${className}` : ''}`}
    onPointerEnter={() => setOpen(true)}
    onPointerLeave={() => setOpen(false)}
    onFocus={(event) => { onFocus?.(event); setOpen(true); }}
    onBlur={(event) => { onBlur?.(event); setOpen(false); }}
    onClick={onClick}
    onKeyDown={onKeyDown}>
    {children}<OverlayLayer open={open} kind="tooltip" anchor={anchor} placement={placement} onDismiss={() => setOpen(false)}>
      {label}
    </OverlayLayer>
  </span>;
});
export interface DialogProps {
  open: boolean; title: ReactNode; children?: ReactNode; description?: ReactNode;
  footer?: ReactNode; onDismiss: (reason: DismissReason) => void;
  width?: number | string; className?: string; style?: CSSProperties;
  closeLabel?: string; dismissOutside?: boolean; onOpenChange?: (open: boolean) => void;
  contentStyle?: CSSProperties;
}
export function Dialog({ title, description, footer, children, width = 520, closeLabel = 'Close',
  onOpenChange, contentStyle, ...props }: DialogProps) {
  const titleId = useId(), descriptionId = useId();
  useEffect(() => { onOpenChange?.(props.open); }, [props.open, onOpenChange]);
  return <OverlayLayer {...props} kind="dialog" labelledBy={titleId} describedBy={description ? descriptionId : undefined}
    style={{ width, ...props.style }}>
    <header className="pt-dialog-header"><h2 id={titleId}>{title}</h2>
      <IconButton actionId="dialog.close" iconId="close" label={closeLabel} emphasis="quiet"
        onActivate={() => props.onDismiss('close')} /></header>
    {description && <div id={descriptionId} className="pt-dialog-description">{description}</div>}
    <div className="pt-dialog-body" style={contentStyle}>{children}</div>
    {footer !== undefined && footer !== null && <footer className="pt-dialog-footer">{footer}</footer>}
  </OverlayLayer>;
}
export interface DrawerProps extends DialogProps { side?: 'left' | 'right' | 'bottom'; extra?: ReactNode }
export function Drawer({ title, description, footer, children, width = 420, side = 'right', extra,
  closeLabel = 'Close', contentStyle, ...props }: DrawerProps) {
  const titleId = useId();
  return <OverlayLayer {...props} kind="drawer" labelledBy={titleId}
    className={`pt-drawer-${side} ${props.className ?? ''}`} style={{ width: side === 'bottom' ? '100%' : width, ...props.style }}>
    <header className="pt-dialog-header"><h2 id={titleId}>{title}</h2>{extra}
      <IconButton actionId="drawer.close" iconId="close" label={closeLabel} emphasis="quiet"
        onActivate={() => props.onDismiss('close')} /></header>
    {description}<div className="pt-dialog-body" style={contentStyle}>{children}</div>
    {footer && <footer className="pt-dialog-footer">{footer}</footer>}
  </OverlayLayer>;
}
export interface ConfirmActionProps extends Omit<DialogProps, 'open' | 'onDismiss' | 'footer'> {
  children: ReactNode; confirmLabel: string; cancelLabel: string;
  actionId: string; onConfirm: () => unknown | Promise<unknown>; onCancel?: () => void;
}
export function ConfirmAction({ children, confirmLabel, cancelLabel, actionId, onConfirm, onCancel, ...props }: ConfirmActionProps) {
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [failure, setFailure] = useState('');
  const { trigger } = useTrigger(children, open, setOpen, 'popover');
  return <>{trigger}<Dialog {...props} open={open} onDismiss={() => { if (!pending) { setOpen(false); setFailure(''); onCancel?.(); } }}
    footer={<><Button actionId={`${actionId}.cancel`} label={cancelLabel}
      availability={pending ? {kind:'disabled',reason:'Confirmation is running'} : undefined}
      onActivate={() => { setOpen(false); setFailure(''); onCancel?.(); }} />
      <Button actionId={actionId} label={confirmLabel} tone="danger" emphasis="primary"
        execution={pending?'pending':'idle'} onActivate={async () => {
          setPending(true); setFailure('');
          try { await onConfirm(); setOpen(false); }
          catch (error) { setFailure(error instanceof Error ? error.message : String(error)); }
          finally { setPending(false); }
        }} /></>}>
    {failure && <div role="alert">{failure}</div>}
  </Dialog></>;
}
export interface SplitButtonProps {
  actionId: string; label: string; onActivate: () => void;
  alternativesLabel: string; alternatives: readonly MenuAction[];
  emphasis?: 'primary' | 'secondary'; tone?: 'neutral' | 'danger';
  availability?: import('@peers-touch/ui-contracts').Availability;
  execution?: import('@peers-touch/ui-contracts').ActionExecution;
  leading?: ReactNode;
}
export function SplitButton({ actionId, label, onActivate, alternativesLabel, alternatives,
  emphasis = 'primary', tone = 'neutral', availability, execution, leading }: SplitButtonProps) {
  // B11: both trigger areas share one contour and one disabled/pending policy;
  // opening the alternative menu never fires the default action.
  return <div className="pt-split-button" data-tone={tone}>
    <span className="pt-split-main"><Button actionId={actionId} label={label} emphasis={emphasis} tone={tone}
      availability={availability} execution={execution} leading={leading} onActivate={onActivate} /></span>
    <span className="pt-split-trigger"><Menu actions={alternatives} placement="bottom">
      <IconButton actionId={`${actionId}.alternatives`} iconId="chevron-down" label={alternativesLabel}
        emphasis={emphasis} tone={tone} availability={availability} execution={execution} aria-haspopup="menu" />
    </Menu></span>
  </div>;
}
