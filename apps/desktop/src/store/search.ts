import { createDesktopStore } from './createDesktopStore';
import type { SearchResponse } from '../gen/proto/domain/search/search_pb';
import type { Page } from '../types/navigation';

export type SearchMode = 'suggest' | 'submit' | 'functions';
export interface SearchState {
  open: boolean;
  query: string;
  mode: SearchMode;
  status: 'idle' | 'loading' | 'ready' | 'error';
  response: SearchResponse | null;
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
  errorKey: null, opening: false, selectedIndex: 0, cursorEngaged: false,
  scrollTop: 0, originPage: 'chat', returnAvailable: false,
});

export const useSearchStore = createDesktopStore<SearchState>('search', emptySearchState);
