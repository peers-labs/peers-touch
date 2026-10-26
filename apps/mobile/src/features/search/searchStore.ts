import { create } from 'zustand';
import type { SearchResponse } from '../../gen/proto/domain/search/search_pb';

export type MobileSearchFilter = 'all' | 'messages' | 'social' | 'attachments' | 'functions';
export interface MobileSearchProjection {
  query: string;
  filter: MobileSearchFilter;
  conversationId: string;
  locale: string;
  mode: 'suggest' | 'submit';
  status: 'idle' | 'loading' | 'ready' | 'error' | 'concealed';
  response: SearchResponse | null;
  errorKey: string | null;
  selectedId: string;
  scrollTop: number;
  cursors: string[];
  page: number;
  opening: boolean;
  displayedQuery: string;
  displayedMode: 'suggest' | 'submit';
  displayedFilter: MobileSearchFilter;
  stalled: boolean;
}

export const emptyMobileSearch = (): MobileSearchProjection => ({
  query: '', filter: 'all', conversationId: '', locale: 'en', mode: 'suggest',
  status: 'idle', response: null, errorKey: null, selectedId: '', scrollTop: 0,
  cursors: [''], page: 0, opening: false,
  displayedQuery: '', displayedMode: 'suggest', displayedFilter: 'all', stalled: false,
});

export const useMobileSearchStore = create<MobileSearchProjection>(() => emptyMobileSearch());
