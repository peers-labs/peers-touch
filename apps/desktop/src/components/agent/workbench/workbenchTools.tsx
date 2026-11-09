import type { ReactNode } from 'react';
import {
  ListChecks,
  FileText,
  Globe,
  TerminalSquare,
  Brain,
  GitFork,
} from 'lucide-react';

import type { WorkbenchToolId } from '../../../store/workbenchTabs';

export interface WorkbenchToolMeta {
  id: WorkbenchToolId;
  icon: ReactNode;
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
    icon: <ListChecks size={16} />,
    labelKey: 'chat.workbench.tab.summary',
    descKey: 'chat.workbench.desc.summary',
  },
  {
    id: 'file',
    icon: <FileText size={16} />,
    labelKey: 'chat.workbench.tab.file',
    descKey: 'chat.workbench.desc.file',
  },
  {
    id: 'browser',
    icon: <Globe size={16} />,
    labelKey: 'chat.workbench.tab.browser',
    descKey: 'chat.workbench.desc.browser',
  },
  {
    id: 'terminal',
    icon: <TerminalSquare size={16} />,
    labelKey: 'chat.workbench.tab.terminal',
    descKey: 'chat.workbench.desc.terminal',
    closeAttr: 'data-pt-terminal-close',
  },
  {
    id: 'memory',
    icon: <Brain size={16} />,
    labelKey: 'chat.workbench.tab.memory',
    descKey: 'chat.workbench.desc.memory',
  },
  {
    id: 'branches',
    icon: <GitFork size={16} />,
    labelKey: 'chat.workbench.tab.branches',
    descKey: 'chat.workbench.desc.branches',
  },
];
