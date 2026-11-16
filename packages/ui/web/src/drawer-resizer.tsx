import { useLayoutEffect, useRef } from 'react';
import { drawerPolicy } from './drawer-assembly';
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
  const { catalog } = drawerPolicy;
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
      aria-label={label} title={label} aria-orientation="vertical"
      aria-valuemin={Math.round(assembly.pose.catalogResizeMin)} aria-valuemax={Math.round(assembly.pose.catalogResizeMax)}
      aria-valuenow={Math.round(assembly.pose.visibleCatalog)}
      aria-disabled={!available} tabIndex={available ? 0 : -1}
      data-chat-rail-resize data-dragging={assembly.dragging} data-available={available}
      onPointerDown={event => {
        if (!available || event.button !== 0 || pointer.current !== null) return;
        event.preventDefault();
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
      <span className={lineClassName} />
    </div>
  );
}
