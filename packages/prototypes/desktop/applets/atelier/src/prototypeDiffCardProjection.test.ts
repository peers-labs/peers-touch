import { describe, expect, it } from 'vitest';
import { ATELIER_PROJECTION_DISPLAY_LIMITS } from './projection.contract.generated';
import { derivePrototypeDiffCardProjectionView } from './prototypeDiffCardProjection';
import type { DiffBlock } from './types';

function diffBlock(input: Partial<DiffBlock> = {}): DiffBlock {
  return {
    kind: 'diff',
    id: 'diff-1',
    files: 2,
    added: 12,
    removed: 3,
    paths: ['src/a.ts', 'src/b.ts'],
    ...input,
  };
}

describe('prototypeDiffCardProjection', () => {
  it('uses generated diff path display limit for compact stream metadata', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.diffPaths;
    const paths = Array.from({ length: limit + 2 }, (_, index) => `src/file-${index}.ts`);

    expect(derivePrototypeDiffCardProjectionView(diffBlock({ paths }))).toMatchObject({
      visiblePaths: paths.slice(0, limit),
      hiddenPathCount: 2,
      emptyPathsVisible: false,
    });
  });

  it('builds summary labels from Station-projected diff metadata only', () => {
    expect(derivePrototypeDiffCardProjectionView(diffBlock({
      files: 4,
      added: 18,
      removed: 7,
    }))).toMatchObject({
      glyph: '⊟',
      summaryLabel: '4 files changed',
      addedLabel: '+18',
      removedLabel: '-7',
    });
  });

  it('renders empty diff path metadata without creating patch or execution affordances', () => {
    const view = derivePrototypeDiffCardProjectionView(diffBlock({ paths: [] }));

    expect(view).toMatchObject({
      visiblePaths: [],
      hiddenPathCount: 0,
      emptyPathsVisible: true,
    });
    expect(JSON.stringify(view)).not.toMatch(/body|patch|execute|provider|shell|fileAction/);
  });

  it('does not report hidden paths when projected refs fit the generated limit', () => {
    const limit = ATELIER_PROJECTION_DISPLAY_LIMITS.diffPaths;
    const paths = Array.from({ length: limit }, (_, index) => `src/file-${index}.ts`);

    expect(derivePrototypeDiffCardProjectionView(diffBlock({ paths }))).toMatchObject({
      visiblePaths: paths,
      hiddenPathCount: 0,
      emptyPathsVisible: false,
    });
  });
});
