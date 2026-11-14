// Focused tests for the pure Search frame contract:
//   - progressive frames merge by source and never gain a cursor
//   - roving keyboard model moves real focus and returns to the input
//   - coverage status and authorized copy text never invent content
import { describe, expect, it, vi } from 'vitest';
import { create, toBinary } from '@bufbuild/protobuf';
import {
  SearchResponseSchema, SourceState, type ResultItem, type SearchResponse,
  type SourceCoverage,
} from '../gen/proto/domain/search/search_pb';
import { decodeSearchFrame } from '../services/search';
import {
  STABLE_ADMISSION_MS, MAX_QUERY_CHARS, authorizedRowCopyText, clampQuery,
  coverageStatus, deliveredCoverage, isPrintableCharacterKey, mergeProgressiveFrame,
  nextRovingIndex, pendingSources, retainTransientlyUnavailableSources, searchPresentation,
} from '../runtimes/searchFrames';

function source(sourceId: string) {
  return { sourceId, bindingId: `${sourceId}.read`, readScope: 'alice', state: SourceState.READY, noStore: true };
}

function item(sourceId: string, id: string, title = id, snippet = `${id}-snippet`): ResultItem {
  return {
    sourceId, title, snippet,
    resource: { authorityNamespace: 'ns', kind: 'social-comment', id, contentRevision: '1' },
  } as ResultItem;
}

function response(init: Partial<SearchResponse>): SearchResponse {
  return {
    partition: 'alice',
    sources: [source('device.messaging'), source('station.social.public')],
    coverage: [], expiresAtUnixMs: BigInt(10_000),
    items: [], nextCursor: '', hasMore: false, ...init,
  } as unknown as SearchResponse;
}

describe('progressive frame merge', () => {
  it('publishes the first source frame without a cursor or ranking claim', () => {
    const frame = response({
      items: [item('device.messaging', 'a')],
      coverage: [{ sourceId: 'device.messaging', state: SourceState.READY } as SourceCoverage],
    });
    const merged = mergeProgressiveFrame(null, frame, 'device.messaging', []);
    expect(merged.response.items.map(row => row.resource?.id)).toEqual(['a']);
    expect(merged.response.nextCursor).toBe('');
    expect(merged.response.hasMore).toBe(false);
    expect(merged.deliveredSources).toEqual(['device.messaging']);
  });

  it('appends a second source in native vector order and tracks pending sources', () => {
    const first = response({ items: [item('device.messaging', 'a')] });
    const one = mergeProgressiveFrame(null, first, 'device.messaging', []);
    expect(pendingSources(one.response, one.deliveredSources).map(id => id))
      .toEqual(['station.social.public']);

    const second = response({ items: [item('station.social.public', 'b')] });
    const merged = mergeProgressiveFrame(one.response, second, 'station.social.public', one.deliveredSources);
    expect(merged.response.items.map(row => row.sourceId)).toEqual([
      'device.messaging', 'station.social.public',
    ]);
    expect(pendingSources(merged.response, merged.deliveredSources)).toEqual([]);
  });

  it('replaces a re-delivered source instead of duplicating items', () => {
    const first = response({ items: [item('station.social.public', 'old')] });
    const one = mergeProgressiveFrame(null, first, 'station.social.public', []);
    const retried = response({ items: [item('station.social.public', 'new')] });
    const merged = mergeProgressiveFrame(one.response, retried, 'station.social.public', one.deliveredSources);
    expect(merged.response.items.map(row => row.resource?.id)).toEqual(['new']);
    expect(merged.deliveredSources).toEqual(['station.social.public']);
  });

  it('keeps the shortest expiry across progressive frames', () => {
    const one = mergeProgressiveFrame(
      null, response({ expiresAtUnixMs: BigInt(5_000) }), 'device.messaging', [],
    );
    const merged = mergeProgressiveFrame(
      one.response, response({ expiresAtUnixMs: BigInt(8_000) }),
      'station.social.public', one.deliveredSources,
    );
    expect(merged.response.expiresAtUnixMs).toBe(BigInt(5_000));
  });
});

describe('roving keyboard model', () => {
  it('moves from input to the first row only on ArrowDown', () => {
    expect(nextRovingIndex(null, 1, 3)).toBe(0);
    expect(nextRovingIndex(null, -1, 3)).toBeNull();
  });
  it('moves between rows and returns to input past either edge', () => {
    expect(nextRovingIndex(1, 1, 3)).toBe(2);
    expect(nextRovingIndex(2, 1, 3)).toBeNull();
    expect(nextRovingIndex(0, -1, 3)).toBeNull();
  });
  it('never moves without rows', () => {
    expect(nextRovingIndex(null, 1, 0)).toBeNull();
  });
  it('recognizes printable characters that return focus to the input', () => {
    expect(isPrintableCharacterKey('a')).toBe(true);
    expect(isPrintableCharacterKey('中')).toBe(true);
    expect(isPrintableCharacterKey(' ')).toBe(true);
    expect(isPrintableCharacterKey('ArrowDown')).toBe(false);
    expect(isPrintableCharacterKey('Dead')).toBe(false);
  });
});

describe('coverage and copy content', () => {
  it('maps coverage states to compact status kinds', () => {
    const coverage = (state: SourceState, detailKey = '') => ({ state, detailKey }) as SourceCoverage;
    expect(coverageStatus(coverage(SourceState.READY))).toBeNull();
    expect(coverageStatus(coverage(SourceState.PARTIAL))).toBe('partial');
    expect(coverageStatus(coverage(SourceState.INDEXING))).toBe('preparing');
    expect(coverageStatus(coverage(SourceState.UNAVAILABLE, 'search.coverage.source_timeout'))).toBe('timeout');
    expect(coverageStatus(coverage(SourceState.UNAVAILABLE, 'search.coverage.source_unavailable'))).toBe('denied');
  });

  it('copies only authorized title/snippet text with no fabricated fallback', () => {
    expect(authorizedRowCopyText(item('s', 'id', 'Title', 'Snippet'))).toBe('Title\nSnippet');
    expect(authorizedRowCopyText(item('s', 'id', 'Title', ''))).toBe('Title');
    expect(authorizedRowCopyText({ ...item('s', 'id'), title: '', snippet: '' })).toBe('');
  });
});

describe('input boundary', () => {
  it('clamps to 256 Unicode scalars and admits after 200ms', () => {
    expect(Array.from(clampQuery('a'.repeat(300)))).toHaveLength(MAX_QUERY_CHARS);
    expect(Array.from(clampQuery('中'.repeat(300)))).toHaveLength(MAX_QUERY_CHARS);
    expect(Array.from(clampQuery('🙂'.repeat(300)))).toHaveLength(MAX_QUERY_CHARS);
    expect(STABLE_ADMISSION_MS).toBe(200);
  });
});

describe('progressive presentation decision', () => {
  const base = {
    mode: 'submit' as const, draft: 'camino', displayedQuery: '',
    contentFilter: 'social' as const, displayedFilter: 'social' as const,
    status: 'loading' as const, errorKey: null,
    response: null, progressive: null,
    progressiveRequestId: 'req-1', progressiveSources: [],
  };

  it('never shows empty, recent or quick functions during a zero-hit progressive FIND', () => {
    // One source delivered zero items; the other is still pending.
    const progressive = response({ items: [] });
    const presentation = searchPresentation({
      ...base, progressive, progressiveSources: ['device.messaging'],
    });
    expect(presentation.isProgressive).toBe(true);
    expect(presentation.showEmpty).toBe(false);
    expect(presentation.showQuickFunctions).toBe(false);
    expect(presentation.groupTitle).toBe('search.results');
    expect(presentation.pendingSources).toEqual(['station.social.public']);
  });

  it('shows the empty state only on the qualified final frame with no pending sources', () => {
    const finalResponse = response({ items: [] });
    const ready = searchPresentation({
      ...base, status: 'ready', response: finalResponse,
      displayedQuery: 'camino', progressive: null, progressiveRequestId: null,
    });
    expect(ready.showEmpty).toBe(true);
    expect(ready.isProgressive).toBe(false);

    // Same final frame shape but still loading (e.g. late publication): no empty.
    const loading = searchPresentation({
      ...base, status: 'loading', response: finalResponse,
      displayedQuery: 'camino', progressive: null, progressiveRequestId: null,
    });
    expect(loading.showEmpty).toBe(false);

    // Terminal error must never render empty, even with a zero-item frame.
    const errored = searchPresentation({
      ...base, status: 'error', errorKey: 'search.error.timeout',
      response: finalResponse, displayedQuery: 'camino',
      progressive: null, progressiveRequestId: null,
    });
    expect(errored.showEmpty).toBe(false);
  });

  it('labels an empty Device-suggestion draft as recent with quick functions', () => {
    const presentation = searchPresentation({
      ...base, mode: 'suggest', draft: '', status: 'ready',
      progressiveRequestId: null, response: response({ items: [] }),
    });
    expect(presentation.groupTitle).toBe('search.recent');
    expect(presentation.showQuickFunctions).toBe(true);
    expect(presentation.isProgressive).toBe(false);
  });

  it('labels a non-empty Device draft as suggestions, never results', () => {
    const presentation = searchPresentation({
      ...base, mode: 'suggest', draft: 'history', status: 'ready',
      progressiveRequestId: null, response: response({ items: [item('device.messaging', 'a')] }),
    });
    expect(presentation.groupTitle).toBe('search.suggestions');
    expect(presentation.showQuickFunctions).toBe(false);
  });

  it('claims coverage only for delivered sources during a progressive FIND', () => {
    const progressive = response({
      items: [item('device.messaging', 'a')],
      coverage: [
        { sourceId: 'device.messaging', state: SourceState.READY } as SourceCoverage,
        { sourceId: 'station.social.public', state: SourceState.READY } as SourceCoverage,
      ],
    });
    const presentation = searchPresentation({
      ...base, progressive, progressiveSources: ['device.messaging'],
    });
    const claimed = deliveredCoverage(presentation, ['device.messaging']);
    expect(claimed.map(item => item.sourceId)).toEqual(['device.messaging']);

    // After the fused final frame every coverage line is claimable.
    const finalPresentation = searchPresentation({
      ...base, status: 'ready', response: progressive,
      displayedQuery: 'camino', progressive: null, progressiveRequestId: null,
    });
    expect(deliveredCoverage(finalPresentation, []).map(item => item.sourceId))
      .toEqual(['device.messaging', 'station.social.public']);
  });
});

describe('scheduled reconcile continuity', () => {
  const rowKey = (candidate: ResultItem) => candidate.resource?.id ?? '';
  const socialSources = ['device.social', 'station.social.public'];
  const socialSourceStates = socialSources.map(source) as SearchResponse['sources'];
  const readyCoverage = socialSources.map(sourceId =>
    ({ sourceId, state: SourceState.READY }) as SourceCoverage);

  it('retains previously qualified rows when a source is transiently unavailable, keeping prior order', () => {
    const previous = response({
      sources: socialSourceStates,
      coverage: readyCoverage,
      items: [
        item('device.social', 'private-comment'),
        item('station.social.public', 'public-comment'),
        item('device.social', 'private-post'),
        item('station.social.public', 'public-post'),
      ],
    });
    const next = response({
      sources: socialSourceStates,
      coverage: [
        { sourceId: 'device.social', state: SourceState.UNAVAILABLE, detailKey: 'search.coverage.source_unavailable' } as SourceCoverage,
        { sourceId: 'station.social.public', state: SourceState.READY } as SourceCoverage,
      ],
      items: [
        item('station.social.public', 'public-comment'),
        item('station.social.public', 'public-post'),
      ],
    });
    const merged = retainTransientlyUnavailableSources(previous, next, rowKey);
    expect(merged.items.map(rowKey)).toEqual([
      'private-comment', 'public-comment', 'private-post', 'public-post',
    ]);
  });

  it('does not retain rows when every source stays ready or when the source never had rows', () => {
    const previous = response({
      sources: socialSourceStates, coverage: readyCoverage,
      items: [item('station.social.public', 'public-post')],
    });
    const unchanged = response({
      sources: socialSourceStates, coverage: readyCoverage,
      items: [item('station.social.public', 'public-post')],
    });
    expect(retainTransientlyUnavailableSources(previous, unchanged, rowKey)).toBe(unchanged);

    const otherSourceGone = response({
      sources: socialSourceStates,
      coverage: [
        { sourceId: 'device.social', state: SourceState.UNAVAILABLE } as SourceCoverage,
        { sourceId: 'station.social.public', state: SourceState.READY } as SourceCoverage,
      ],
      items: [item('station.social.public', 'public-post')],
    });
    expect(retainTransientlyUnavailableSources(previous, otherSourceGone, rowKey))
      .toBe(otherSourceGone);
  });

  it('appends genuinely new rows while preserving retained order', () => {
    const previous = response({
      sources: socialSourceStates, coverage: readyCoverage,
      items: [item('device.social', 'p1'), item('station.social.public', 'u1')],
    });
    const next = response({
      sources: socialSourceStates,
      coverage: [
        { sourceId: 'device.social', state: SourceState.UNAVAILABLE } as SourceCoverage,
        { sourceId: 'station.social.public', state: SourceState.READY } as SourceCoverage,
      ],
      items: [
        item('station.social.public', 'u1'),
        item('station.social.public', 'u2'),
      ],
    });
    const merged = retainTransientlyUnavailableSources(previous, next, rowKey);
    expect(merged.items.map(rowKey)).toEqual(['p1', 'u1', 'u2']);
  });
});

describe('native frame envelope', () => {
  it('decodes a base64 SearchResponse and rejects malformed envelopes', () => {
    const frame = response({ items: [item('device.messaging', 'a')] });
    const bytes = toBinary(SearchResponseSchema, create(SearchResponseSchema, frame));
    let binary = '';
    bytes.forEach(value => { binary += String.fromCharCode(value); });
    const payload = {
      requestId: 'req-1', frameKind: 'progressive', sourceId: 'device.messaging',
      frameBytesB64: btoa(binary),
    };
    const decoded = decodeSearchFrame(payload);
    expect(decoded?.requestId).toBe('req-1');
    expect(decoded?.sourceId).toBe('device.messaging');
    expect(decoded?.response.items[0].resource?.id).toBe('a');
    expect(decodeSearchFrame({ ...payload, frameKind: 'final' })).toBeNull();
    expect(decodeSearchFrame({ ...payload, frameBytesB64: 'not-base64!!' })).toBeNull();
    expect(decodeSearchFrame(null)).toBeNull();
    expect(decodeSearchFrame({ requestId: '', frameKind: 'progressive' })).toBeNull();
  });

  it('never throws on non-object platform events', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(decodeSearchFrame('unexpected')).toBeNull();
    expect(decodeSearchFrame(42)).toBeNull();
    warn.mockRestore();
  });
});
