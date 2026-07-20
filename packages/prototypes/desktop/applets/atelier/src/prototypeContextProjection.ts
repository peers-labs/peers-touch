import {
  ATELIER_CONTEXT_FILE_GROUPS,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import type { ContextFile, ContextFileGroup, TaskContext } from './types';

export interface PrototypeContextTabView {
  group: ContextFileGroup;
  label: string;
  active: boolean;
}

export interface PrototypeContextProjectionView {
  usedPct: number;
  tabs: PrototypeContextTabView[];
  visibleFiles: ContextFile[];
  hiddenFileCount: number;
  emptyVisible: boolean;
}

const CONTEXT_FILE_GROUP_LABELS: Record<ContextFileGroup, string> = {
  files: 'Files',
  other: 'Other',
};

const CONTEXT_FILE_GROUP_DISPLAY_LIMITS: Record<ContextFileGroup, number> = {
  files: ATELIER_PROJECTION_DISPLAY_LIMITS.contextFileRefs,
  other: ATELIER_PROJECTION_DISPLAY_LIMITS.contextOtherRefs,
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function derivePrototypeContextProjectionView(input: {
  ctx: TaskContext;
  tab: ContextFileGroup;
}): PrototypeContextProjectionView {
  const filesForTab = input.ctx.files.filter((file) => file.group === input.tab);
  const displayLimit = CONTEXT_FILE_GROUP_DISPLAY_LIMITS[input.tab];
  const visibleFiles = filesForTab.slice(0, displayLimit);

  return {
    usedPct: clampPercent(input.ctx.usedPct),
    tabs: ATELIER_CONTEXT_FILE_GROUPS.map((group) => ({
      group,
      label: CONTEXT_FILE_GROUP_LABELS[group],
      active: input.tab === group,
    })),
    visibleFiles,
    hiddenFileCount: Math.max(0, filesForTab.length - visibleFiles.length),
    emptyVisible: filesForTab.length === 0,
  };
}
