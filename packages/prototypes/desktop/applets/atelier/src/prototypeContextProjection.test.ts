import { describe, expect, it } from 'vitest';
import {
  ATELIER_CONTEXT_FILE_GROUPS,
  ATELIER_PROJECTION_DISPLAY_LIMITS,
} from './projection.contract.generated';
import { derivePrototypeContextProjectionView } from './prototypeContextProjection';
import type { ContextFile, ContextFileGroup, TaskContext } from './types';

function context(files: ContextFile[], usedPct = 42): TaskContext {
  return { files, usedPct };
}

function files(group: ContextFileGroup, count: number): ContextFile[] {
  return Array.from({ length: count }, (_, index) => ({
    group,
    name: `${group}/projected-ref-${index}.ts`,
  }));
}

describe('derivePrototypeContextProjectionView', () => {
  it('renders generated context tabs without creating workspace discovery actions', () => {
    const view = derivePrototypeContextProjectionView({
      ctx: context([]),
      tab: 'files',
    });

    expect(view.tabs.map((tab) => tab.group)).toEqual([...ATELIER_CONTEXT_FILE_GROUPS]);
    expect(view.tabs.find((tab) => tab.group === 'files')).toMatchObject({
      label: 'Files',
      active: true,
    });
    expect(view.tabs.find((tab) => tab.group === 'other')).toMatchObject({
      label: 'Other',
      active: false,
    });
  });

  it('uses generated file ref display limit for Station-projected file refs', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.contextFileRefs;
    const projectedFiles = files('files', limit + 2);

    expect(derivePrototypeContextProjectionView({
      ctx: context(projectedFiles),
      tab: 'files',
    })).toMatchObject({
      visibleFiles: projectedFiles.slice(0, limit),
      hiddenFileCount: 2,
      emptyVisible: false,
    });
  });

  it('uses generated other ref display limit independently from file refs', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.contextOtherRefs;
    const projectedOtherRefs = files('other', limit + 1);

    expect(derivePrototypeContextProjectionView({
      ctx: context([...files('files', 2), ...projectedOtherRefs]),
      tab: 'other',
    })).toMatchObject({
      visibleFiles: projectedOtherRefs.slice(0, limit),
      hiddenFileCount: 1,
      emptyVisible: false,
    });
  });

  it('keeps empty state local to the selected projected context group', () => {
    expect(derivePrototypeContextProjectionView({
      ctx: context(files('files', 1)),
      tab: 'other',
    })).toMatchObject({
      visibleFiles: [],
      hiddenFileCount: 0,
      emptyVisible: true,
    });
  });

  it('clamps context usage display without mutating Station context projection', () => {
    expect(derivePrototypeContextProjectionView({
      ctx: context([], 139.6),
      tab: 'files',
    }).usedPct).toBe(100);
    expect(derivePrototypeContextProjectionView({
      ctx: context([], Number.NaN),
      tab: 'files',
    }).usedPct).toBe(0);
  });
});
