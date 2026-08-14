import type React from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * Context passed to ActionBar items for interacting with the composer.
 */
export interface ActionBarContext {
  /** Trigger the hidden file input */
  triggerFileInput: () => void;
  /** Insert text at cursor position */
  insertText: (text: string) => void;
  /** Current textarea ref */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Whether streaming is active */
  isStreaming: boolean;
}

/**
 * A single action item rendered in the ActionBar.
 * Registry-driven: add new items without touching ActionBar internals.
 */
export interface ActionBarItem {
  /** Unique key used for ordering and conditional rendering */
  key: string;
  /** Lucide icon component */
  icon: LucideIcon;
  /** i18n key for tooltip */
  titleKey: string;
  /** Click handler — receives composer context */
  onAction: (ctx: ActionBarContext) => void;
  /** Whether item is visible (default: true) */
  visible?: boolean | ((ctx: ActionBarContext) => boolean);
  /** Whether item is disabled */
  disabled?: boolean | ((ctx: ActionBarContext) => boolean);
}
