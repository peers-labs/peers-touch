import { sdk } from '@peers-touch/applet-sdk';

const ID = 'web-search';

export interface SearchResultItem {
  id: string;
  source: string;
  title: string;
  snippet: string;
  url?: string;
  icon?: string;
  metadata?: Record<string, string>;
}

export interface SearchSource {
  id: string;
  name: string;
  icon: string;
  description?: string;
  builtin: boolean;
  applet_id?: string;
}

export interface SearchSourceGroup {
  source: SearchSource;
  items: SearchResultItem[];
  total: number;
}

interface SearchResponse {
  query: string;
  source: string;
  groups?: SearchSourceGroup[];
  results?: SearchResultItem[];
  count?: number;
}

export const api = {
  appletAction: <T = unknown>(action: string, params?: Record<string, unknown>) =>
    sdk.invoke<T>('applets_action', { id: ID, action, params }),

  search: (query: string, source = 'all', limit = 20) =>
    sdk.invoke<SearchResponse>('search_query', { query, source, limit }),
};
