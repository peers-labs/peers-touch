import { createDesktopStore } from './createDesktopStore';
import type { SearchResponse } from '../gen/proto/domain/search/search_pb';
import type { Page } from '../types/navigation';

export type SearchMode = 'suggest' | 'submit' | 'functions';
export type SearchContentFilter = 'all' | 'messages' | 'social' | 'attachments';
export interface SearchTraversal {
  identity: string;
  query: string;
  mode: Exclude<SearchMode, 'functions'>;
  filter: SearchContentFilter;
  locale: string;
  ordinal: number;
  noStore: boolean;
  rowKeys: string[];
}
export interface SearchState {
  open: boolean;
  query: string;
  mode: SearchMode;
  displayedQuery: string;
  displayedMode: Exclude<SearchMode, 'functions'>;
  contentFilter: SearchContentFilter;
  displayedFilter: SearchContentFilter;
  status: 'idle' | 'loading' | 'ready' | 'error';
  stalled: boolean;
  response: SearchResponse | null;
  traversal: SearchTraversal | null;
  errorKey: string | null;
  opening: boolean;
  selectedIndex: number;
  cursorEngaged: boolean;
  scrollTop: number;
  originPage: Page;
  returnAvailable: boolean;
}

// Projection only. Search runtime owns all reads, cache and lifecycle.
export const emptySearchState = (): SearchState => ({
  open: false, query: '', mode: 'suggest', status: 'idle', response: null,
  traversal: null,
  displayedQuery: '', displayedMode: 'suggest', stalled: false,
  contentFilter: 'all', displayedFilter: 'all',
  errorKey: null, opening: false, selectedIndex: 0, cursorEngaged: false,
  scrollTop: 0, originPage: 'chat', returnAvailable: false,
});

export const useSearchStore = createDesktopStore<SearchState>('search', emptySearchState);
