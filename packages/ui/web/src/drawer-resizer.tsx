import { useLayoutEffect, useRef, useState } from 'react';
import { geometry } from '@peers-touch/ui-tokens';
import { bounded, drawerPolicy } from './drawer-assembly';
import type { DrawerAssemblyController } from './use-drawer-assembly';

/** This handle supplies intent only. The assembly owns all drawn geometry. */
export function DrawerRailResizer({ assembly, label, className, lineClassName, ...attributes }: {
  assembly: DrawerAssemblyController;
  label: string;
  className?: string;
  lineClassName?: string;
  'data-tauri-drag-region'?: string;
}) {
  const pointer = useRef<number | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  // Programmatic focus() on pointerdown makes :focus-visible match in both
  // Chromium and WebKit, so the hit strip must own input modality explicitly:
  // pointer focus stays visually silent, keyboard focus lights the one line.
  const pointerFocused = useRef(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const { catalog } = drawerPolicy;
  const hitWidth = geometry.chatRail.resizeHitWidth;
  const hitX = bounded(assembly.pose.visibleCatalog - hitWidth / 2, 0, Math.max(0, assembly.pose.width - hitWidth));
  // Pressure changes the drawn range, not the right to pull its visible edge.
  const available = assembly.pose.catalogInteractive &&
    assembly.pose.catalogResizeMax > assembly.pose.catalogResizeMin &&
    !assembly.leaf && assembly.leafProgress === 0 &&
    (assembly.navigation === 0 || assembly.navigation === 1);
  useLayoutEffect(() => {
    if (assembly.dragging || pointer.current === null) return;
    const id = pointer.current;
    pointer.current = null;
    if (handle.current?.hasPointerCapture(id)) handle.current.releasePointerCapture(id);
  }, [assembly.dragging]);
  const release = (event: React.PointerEvent<HTMLDivElement>, cancel: boolean) => {
    if (event.pointerId !== pointer.current) return;
    pointer.current = null;
    if (cancel) assembly.cancelDrag(); else assembly.finishDrag();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return (
    <div {...attributes} ref={handle} className={className} role="separator"
      style={{ left: hitX, width: hitWidth, marginLeft: 0 }}
      aria-label={label} title={label} aria-orientation="vertical"
      aria-valuemin={Math.round(assembly.pose.catalogResizeMin)} aria-valuemax={Math.round(assembly.pose.catalogResizeMax)}
      aria-valuenow={Math.round(assembly.pose.visibleCatalog)}
      aria-disabled={!available} tabIndex={available ? 0 : -1}
      data-chat-rail-resize data-dragging={assembly.dragging} data-available={available}
      data-keyboard-focus={keyboardFocus}
      onFocus={() => {
        setKeyboardFocus(!pointerFocused.current);
        pointerFocused.current = false;
      }}
      onBlur={() => {
        pointerFocused.current = false;
        setKeyboardFocus(false);
      }}
      onPointerDown={event => {
        if (!available || event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
        pointerFocused.current = true;
        setKeyboardFocus(false);
        event.currentTarget.focus({ preventScroll: true });
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        assembly.beginDrag(event.clientX);
      }}
      onPointerMove={event => {
        if (pointer.current === event.pointerId) assembly.moveDrag(event.clientX);
      }}
      onPointerUp={event => {
        if (pointer.current === event.pointerId) assembly.moveDrag(event.clientX);
        release(event, false);
      }}
      onPointerCancel={event => release(event, true)}
      onLostPointerCapture={event => release(event, true)}
      onDoubleClick={() => { if (available) assembly.setCatalog(catalog.default); }}
      onKeyDown={event => {
        if (event.key === 'Escape' && assembly.dragging) {
          assembly.cancelDrag();
          const id = pointer.current;
          pointer.current = null;
          if (id !== null && event.currentTarget.hasPointerCapture(id)) event.currentTarget.releasePointerCapture(id);
          event.preventDefault();
          return;
        }
        if (!available) return;
        // Any non-Escape key means keyboard now owns this handle, even if the
        // focus itself arrived through a prior pointer gesture.
        setKeyboardFocus(true);
        const width = assembly.pose.visibleCatalog;
        let next: number;
        if (event.key === 'Home') next = assembly.pose.catalogResizeMin;
        else if (event.key === 'End') next = assembly.pose.catalogResizeMax;
        else if (event.key === 'ArrowLeft') next = width - catalog.step;
        else if (event.key === 'ArrowRight') next = width + catalog.step;
        else return;
        event.preventDefault();
        assembly.setCatalogBoundary(next, event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
      }}>
      <span className={lineClassName}
        style={{ left: Math.min(hitWidth - 1, assembly.pose.visibleCatalog - hitX) }} />
    </div>
  );
}
