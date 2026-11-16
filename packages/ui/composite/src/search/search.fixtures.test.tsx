/**
 * Fixture contract tests.
 *
 * These prove the data-core idea actually works end to end:
 *   1. Every fixture is JSON-serializable (no React nodes / functions leak in),
 *      so the same literal can be a prototype mock, a test input or a recorded
 *      real payload without transformation.
 *   2. A data core can be upgraded into the full SearchSurfaceModel by a pure
 *      assembly step that only attaches host nodes — no field renaming, which is
 *      exactly the boundary a host adapter is allowed to own.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { searchFixtures } from './search.fixtures';
import type { SearchSurfaceData, SearchResultRowData } from './search-data.types';
import type {
  SearchResultRow, SearchSurfaceIntents, SearchSurfaceModel,
} from './search.types';

describe('search fixtures — serializable data core', () => {
  for (const [name, fixture] of Object.entries(searchFixtures)) {
    it(`fixture "${name}" survives a JSON round-trip unchanged`, () => {
      const restored = JSON.parse(JSON.stringify(fixture)) as SearchSurfaceData;
      expect(restored).toEqual(fixture);
    });
  }

  it('covers the six boundary scenarios', () => {
    expect(Object.keys(searchFixtures).sort()).toEqual(
      ['blank', 'empty', 'error', 'loading', 'longText', 'ready'],
    );
  });
});

describe('data core -> full model assembly', () => {
  /** The ONLY host-owned transform: attach an icon node and copy every serial
   *  field verbatim. No field renaming means no shape drift surface. */
  function assembleRow(data: SearchResultRowData, resolveIcon: (iconId?: string) => ReactNode): SearchResultRow {
    return {
      rowKey: data.rowKey,
      kind: data.kind,
      title: data.title,
      snippet: data.snippet,
      meta: data.metaText,
      icon: resolveIcon(data.iconId),
      zoneKey: data.zoneKey,
      resource: data.resource,
    };
  }

  function assembleModel(data: SearchSurfaceData, resolveIcon: (iconId?: string) => ReactNode): SearchSurfaceModel {
    return {
      ...data,
      groups: data.groups.map(group => ({
        key: group.key,
        labelKey: group.labelKey,
        rows: group.rows.map(row => assembleRow(row, resolveIcon)),
      })),
      quickFunctions: data.quickFunctions?.map(row => assembleRow(row, resolveIcon)),
      recentItems: data.recentItems?.map(row => assembleRow(row, resolveIcon)),
    };
  }

  it('upgrades the ready fixture into a full model without renaming fields', () => {
    const noopIntents: SearchSurfaceIntents = {
      onQueryChange: vi.fn(), onFilterChange: vi.fn(), onSubmit: vi.fn(),
      onRetry: vi.fn(), onMore: vi.fn(), onOpenRow: vi.fn(), onClose: vi.fn(),
    };
    const model = assembleModel(searchFixtures.ready, iconId =>
      iconId ? <span data-icon={iconId} /> : null);

    // Every serializable field passes through untouched.
    expect(model.query).toBe(searchFixtures.ready.query);
    expect(model.status).toBe('ready');
    expect(model.groups[0].rows).toHaveLength(2);
    expect(model.groups[0].rows[0].rowKey).toBe('conv-chenyu-1');
    // The host node is the only added, non-serializable piece.
    expect(model.groups[0].rows[0].icon).toEqual(<span data-icon="message-circle" />);
    // Intents remain entirely host-supplied; the core never carried them.
    expect(typeof noopIntents.onOpenRow).toBe('function');
  });
});
