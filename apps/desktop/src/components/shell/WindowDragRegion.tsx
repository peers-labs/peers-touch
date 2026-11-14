import { cloneElement, type ReactElement } from 'react';

interface WindowDragRegionProps {
  /** The child must forward DOM attributes to its region root. No wrapper is added. */
  children: ReactElement<{ 'data-tauri-drag-region'?: string }>;
  mode?: 'deep' | 'self' | 'none';
}

/**
 * AppShell's native window interaction boundary. Tauri owns hit testing,
 * dragging and platform-specific double-click behavior. Region composition
 * must never install a second pointer listener or change page lifetime/layout.
 *
 * Header titles/blank space use deep; frame margins use self. Native controls
 * are excluded by Tauri. Custom click targets, menus and resize handles must
 * use none on their containing interaction region.
 */
export function WindowDragRegion({ children, mode = 'deep' }: WindowDragRegionProps) {
  return cloneElement(children, {
    'data-tauri-drag-region': mode === 'none' ? 'false' : mode === 'self' ? 'true' : 'deep',
  });
}
