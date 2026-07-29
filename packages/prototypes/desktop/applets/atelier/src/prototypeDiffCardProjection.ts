import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import type { DiffBlock } from './types';

export interface PrototypeDiffCardProjectionView {
  glyph: string;
  summaryLabel: string;
  addedLabel: string;
  removedLabel: string;
  visiblePaths: string[];
  hiddenPathCount: number;
  emptyPathsVisible: boolean;
}

export function derivePrototypeDiffCardProjectionView(block: DiffBlock): PrototypeDiffCardProjectionView {
  const visiblePaths = block.paths.slice(0, ATELIER_PROJECTION_DISPLAY_LIMITS.diffPaths);

  return {
    glyph: '⊟',
    summaryLabel: `${block.files} files changed`,
    addedLabel: `+${block.added}`,
    removedLabel: `-${block.removed}`,
    visiblePaths,
    hiddenPathCount: Math.max(0, block.paths.length - visiblePaths.length),
    emptyPathsVisible: block.paths.length === 0,
  };
}
