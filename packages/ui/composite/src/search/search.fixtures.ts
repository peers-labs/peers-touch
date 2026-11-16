/**
 * SearchSurface fixtures — typed, serializable sample data for the data core.
 *
 * These are the SINGLE source of sample data shared by:
 *   1. composite behavior tests (this package),
 *   2. the prototype specimen board (mock rendering),
 *   3. Desktop adapter tests (assert the real mapper yields the same shape).
 *
 * Every fixture is checked against SearchSurfaceData with `satisfies`, so a
 * renamed field, bad enum or missing required property fails tsc at authoring
 * time — drift cannot survive to runtime. A fixture stays plain JSON-able data;
 * ReactNodes and intents are never placed here.
 */
import type { SearchSurfaceData, SearchResultRowData } from './search-data.types';

/** One representative content row; reused across scenarios. */
const contentRows: SearchResultRowData[] = [
  {
    rowKey: 'conv-chenyu-1',
    kind: 'conversation',
    title: 'chenyu',
    snippet: '今天下午三点对齐方案',
    metaText: '本机 · 会话',
    iconId: 'message-circle',
    zoneKey: 'search.zone.device',
    resource: { kind: 'conversation' },
  },
  {
    rowKey: 'person-zhouhe-1',
    kind: 'person',
    title: '周河',
    snippet: '联邦联系人',
    iconId: 'user',
    zoneKey: 'search.zone.station',
    resource: { id: 'ptid-zhouhe', kind: 'person' },
  },
];

/** Ready state with grouped results — the primary happy-path fixture. */
export const readySurface = {
  query: 'chenyu',
  status: 'ready',
  isProgressive: false,
  groups: [
    {
      key: 'conversation',
      labelKey: 'search.kind.conversations',
      rows: contentRows,
    },
  ],
  quickFunctions: undefined,
  recentItems: undefined,
  showEmpty: false,
  errorKey: null,
  filters: [
    { id: 'all', labelKey: 'search.tab.all', active: true },
    { id: 'messages', labelKey: 'search.tab.messages', active: false },
  ],
  pendingSources: [],
  coverage: [
    { zoneKey: 'search.zone.device', detailKey: 'search.coverage.device' },
    { zoneKey: 'search.zone.station', detailKey: 'search.coverage.station' },
  ],
  hasMore: true,
  opening: false,
  groupTitleKey: 'search.results',
  displayedQuery: 'chenyu',
} satisfies SearchSurfaceData;

/** Empty-query surface: recents + quick functions, no result groups. */
export const blankSurface = {
  query: '',
  status: 'ready',
  isProgressive: false,
  groups: [],
  quickFunctions: [
    { rowKey: 'qf-new-chat', kind: 'function', title: '新建会话', iconId: 'message-circle' },
  ],
  recentItems: [
    { rowKey: 'recent-1', kind: 'conversation', title: '最近联系人' },
  ],
  showEmpty: false,
  errorKey: null,
  filters: [],
  pendingSources: [],
  coverage: [],
  hasMore: false,
  opening: false,
  groupTitleKey: 'search.results',
} satisfies SearchSurfaceData;

/** No-result surface after a non-empty query — exercises the empty state. */
export const emptySurface = {
  query: '不存在的关键词xyz',
  status: 'ready',
  isProgressive: false,
  groups: [],
  showEmpty: true,
  emptyTitleKey: 'search.empty.title',
  errorKey: null,
  filters: [],
  pendingSources: [],
  coverage: [],
  hasMore: false,
  opening: false,
  groupTitleKey: 'search.results',
} satisfies SearchSurfaceData;

/** Progressive loading: pending sources present, no final groups yet. */
export const loadingSurface = {
  query: 'chenyu',
  status: 'loading',
  isProgressive: true,
  groups: [],
  showEmpty: false,
  errorKey: null,
  filters: [],
  pendingSources: ['station.social.public'],
  coverage: [],
  hasMore: false,
  opening: false,
  groupTitleKey: 'search.results',
} satisfies SearchSurfaceData;

/** Error surface — retriable, host owns the retry intent. */
export const errorSurface = {
  query: 'chenyu',
  status: 'error',
  isProgressive: false,
  groups: [],
  showEmpty: false,
  errorKey: 'search.retry',
  filters: [],
  pendingSources: [],
  coverage: [],
  hasMore: false,
  opening: false,
  groupTitleKey: 'search.results',
} satisfies SearchSurfaceData;

/** Long-content boundary: extreme title/snippet lengths for ellipsis testing. */
export const longTextSurface = {
  query: 'long',
  status: 'ready',
  isProgressive: false,
  groups: [
    {
      key: 'message',
      labelKey: 'search.kind.messages',
      rows: [
        {
          rowKey: 'msg-long-1',
          kind: 'message',
          title: '超'.repeat(120),
          snippet: '这是一段非常长的摘要文本，'.repeat(20),
          iconId: 'message-circle',
        } satisfies SearchResultRowData,
      ],
    },
  ],
  showEmpty: false,
  errorKey: null,
  filters: [],
  pendingSources: [],
  coverage: [],
  hasMore: false,
  opening: false,
  groupTitleKey: 'search.results',
} satisfies SearchSurfaceData;

/** All fixtures keyed by scenario name for suites and adapter tests. */
export const searchFixtures = {
  ready: readySurface,
  blank: blankSurface,
  empty: emptySurface,
  loading: loadingSurface,
  error: errorSurface,
  longText: longTextSurface,
} satisfies Record<string, SearchSurfaceData>;
