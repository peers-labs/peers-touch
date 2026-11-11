import type { ComponentProps } from 'react';
import { Icon } from '@peers-touch/ui';

import type { WorkbenchToolId } from '../../../store/workbenchTabs';

// Derive the glyph id union from peers-ui itself so this package needs no
// direct dependency on @peers-touch/ui-assets (same pattern as
// messages/TurnAttribution).
type WorkbenchIconId = ComponentProps<typeof Icon>['iconId'];

export interface WorkbenchToolMeta {
  id: WorkbenchToolId;
  /**
   * peers-ui glyph id. Resolves to the same lucide 0.577 icon set through
   * @peers-touch/ui-assets, so the workbench chrome needs no lucide import.
   */
  iconId: WorkbenchIconId;
  labelKey: string;
  descKey: string;
  /** Attribute emitted on the tab close button for tool-specific e2e gates. */
  closeAttr?: string;
}

// Single registry consumed by the icon rail, the launcher list, the tab strip
// and the compact "+" menu. Order mirrors Trae's task work area: task summary
// first, then the working surfaces; conversation branches (Peers-native
// equivalent of Trae Side Chat) close the list.
export const WORKBENCH_TOOLS: WorkbenchToolMeta[] = [
  {
    id: 'summary',
    iconId: 'list-checks',
    labelKey: 'chat.workbench.tab.summary',
    descKey: 'chat.workbench.desc.summary',
  },
  {
    id: 'file',
    iconId: 'folder-tree',
    labelKey: 'chat.workbench.tab.file',
    descKey: 'chat.workbench.desc.file',
  },
  {
    id: 'browser',
    iconId: 'globe',
    labelKey: 'chat.workbench.tab.browser',
    descKey: 'chat.workbench.desc.browser',
  },
  {
    id: 'terminal',
    iconId: 'terminal',
    labelKey: 'chat.workbench.tab.terminal',
    descKey: 'chat.workbench.desc.terminal',
    closeAttr: 'data-pt-terminal-close',
  },
  {
    id: 'memory',
    iconId: 'brain',
    labelKey: 'chat.workbench.tab.memory',
    descKey: 'chat.workbench.desc.memory',
  },
  {
    id: 'branches',
    iconId: 'git-branch',
    labelKey: 'chat.workbench.tab.branches',
    descKey: 'chat.workbench.desc.branches',
  },
];
