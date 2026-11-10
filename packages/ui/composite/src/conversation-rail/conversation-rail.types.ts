/**
 * Port contract for ConversationRail + ConversationRow (composite package).
 *
 * The rail owns the header (tab segment, expandable in-rail search tile, plus
 * menu slot), the Recent title, the session row units and the empty/error
 * containers. Everything host-specific stays outside:
 *   - contacts pane (contactsSlot), search dropdown (railExtraSlot)
 *   - create-group / find-people dialogs, store projection and pin-first sort
 *   - rail width, overlay profiling and native context-menu telemetry
 *
 * Callbacks live only in ConversationRailIntents; the model carries plain
 * data plus host-rendered avatar nodes and gate hook records.
 *
 * Design references: data-model.md §4, design.md CMP-D02/CMP-D03/CMP-D06.
 */
import type { ReactNode } from 'react';
import type { IconId } from '@peers-touch/ui';
import type { CompositeTranslate } from '../i18n';
import type { SurfaceHooks } from '../hooks';

// ── Row ────────────────────────────────────────────────────────────────────

/** Serializable menu descriptor; the component maps it onto peers-ui Menu and
 *  routes activation through intents (no business callback inside the model). */
export interface ConversationMenuAction {
  id: string;
  label: string;
  iconId?: IconId;
  disabled?: boolean;
  separator?: boolean;
}

export interface ConversationQuickAction {
  id: string;
  iconId: IconId;
  labelKey: string;
}

export interface ConversationRowModel {
  id: string;
  kind: 'friend' | 'group';
  name: string;
  preview?: string;
  /** Formatted time string; the host owns locale/timezone formatting. */
  timeLabel: string;
  unread: number;
  muted: boolean;
  pinned: boolean;
  online?: boolean;
  selfDirect?: boolean;
  /** Host-rendered avatar (UserSquareAvatar / GroupSquareAvatar); CMP-D06. */
  avatarSlot: ReactNode;
  /** Pinned/muted flag icons are host-resolved by iconId through peers-ui Icon. */
  rowActions: ConversationMenuAction[];
  quickActions: ConversationQuickAction[];
  /** Row-level gate hooks projected onto the row item (data-chat-* / data-*). */
  hooks?: Record<string, string | boolean | undefined>;
}

// ── Rail ───────────────────────────────────────────────────────────────────

export interface ConversationRailModel {
  tab: 'chats' | 'contacts';
  searchOpen: boolean;
  searchValue: string;
  recentLabelKey: string;
  searchPlaceholderKey: string;
  searchCloseLabelKey: string;
  /** Host completes pin-first ordering and any local filtering. */
  rows: ConversationRowModel[];
  selectedRowKey: string | null;
  emptyKey?: string;
  error?: { titleKey: string; retryLabelKey: string; mode: 'blocking' | 'stale' } | null;
  /** Plus-menu descriptors; activation routes through onRowAction('rail', id). */
  plusMenuActions: ConversationMenuAction[];
  tabLabelKeys: { chats: string; contacts: string };
}

export interface ConversationRailIntents {
  onTabChange(tab: 'chats' | 'contacts'): void;
  onOpenSearch(): void;
  onCloseSearch(): void;
  onSearchChange(value: string): void;
  onSelectRow(rowKey: string): void;
  onQuickAction(rowKey: string, actionId: string): void;
  onRowAction(rowKey: string, actionId: string): void;
  onRetry?(): void;
}

export interface ConversationRailSlots {
  /** Replaces the whole body when tab === 'contacts'. */
  contactsSlot?: ReactNode;
  /** Production ChatSearchDropdown / prototype extra-people list. */
  railExtraSlot?: ReactNode;
  /** Plus-menu trigger area can be fully supplied by the host. */
  plusMenuSlot?: ReactNode;
}

export type ConversationRailRegionKey =
  | 'pane' | 'header' | 'tabs' | 'searchTile' | 'searchField' | 'plusMenu'
  | 'title' | 'scroll' | 'row' | 'avatar' | 'unread' | 'presence'
  | 'preview' | 'rowActions' | 'empty' | 'error';

export interface ConversationRailProps {
  model: ConversationRailModel;
  intents: ConversationRailIntents;
  slots?: ConversationRailSlots;
  t: CompositeTranslate;
  hooks?: SurfaceHooks<ConversationRailRegionKey>;
}

export type { ReactNode };
