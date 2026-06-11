import { sdk } from '@peers-touch/applet-sdk';

const SITES_KEY = 'web-search.sites.v1';

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

interface PortalSite {
  url: string;
  name: string;
  tags: string[];
  enabled: boolean;
  added_at: string;
  last_crawl?: string;
  articles: number;
}

function parseBody<T>(body: unknown): T {
  if (typeof body === 'string') {
    return JSON.parse(body) as T;
  }
  return body as T;
}

function parseSites(value: unknown): PortalSite[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;
  return Array.isArray(parsed) ? parsed as PortalSite[] : [];
}

async function readSites(): Promise<PortalSite[]> {
  return parseSites(await sdk.storage.get<PortalSite[] | string>(SITES_KEY));
}

async function writeSites(sites: PortalSite[]): Promise<void> {
  await sdk.storage.set(SITES_KEY, sites);
}

function siteName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

async function search(query: string, source = 'all', limit = 20): Promise<SearchResponse> {
  const response = await sdk.network.request<SearchResponse | string>({
    service: 'station-api',
    path: '/api/v1/search',
    method: 'POST',
    body: { query, source, limit },
  });
  if (response.status >= 400) {
    throw new Error(`Search request failed with status ${response.status}`);
  }
  return parseBody<SearchResponse>(response.body);
}

async function runAction<T = unknown>(action: string, params?: Record<string, unknown>): Promise<T> {
  switch (action) {
    case 'list-sites': {
      return { sites: await readSites() } as T;
    }
    case 'add-site': {
      const url = String(params?.url ?? '').trim();
      if (!url) throw new Error('url is required');
      const sites = await readSites();
      if (!sites.some((site) => site.url === url)) {
        sites.push({
          url,
          name: siteName(url),
          tags: [],
          enabled: true,
          added_at: new Date().toISOString(),
          articles: 0,
        });
        await writeSites(sites);
      }
      return { ok: true } as T;
    }
    case 'remove-site': {
      const url = String(params?.url ?? '').trim();
      await writeSites((await readSites()).filter((site) => site.url !== url));
      return { ok: true } as T;
    }
    case 'toggle-site': {
      const url = String(params?.url ?? '').trim();
      const enabled = Boolean(params?.enabled);
      const sites = (await readSites()).map((site) => site.url === url ? { ...site, enabled } : site);
      await writeSites(sites);
      return { ok: true } as T;
    }
    case 'crawl-site': {
      const url = String(params?.url ?? '').trim();
      const handle = await sdk.tasks.start({ taskType: 'web-search.crawl-site', input: { url }, stream: false });
      const sites = (await readSites()).map((site) => site.url === url
        ? { ...site, last_crawl: new Date().toISOString(), articles: site.articles + 1 }
        : site);
      await writeSites(sites);
      return { taskId: handle.taskId, articles: 1 } as T;
    }
    case 'crawl-all': {
      const sites = await readSites();
      const handle = await sdk.tasks.start({
        taskType: 'web-search.crawl-all',
        input: { urls: sites.filter((site) => site.enabled).map((site) => site.url) },
        stream: false,
      });
      const crawledAt = new Date().toISOString();
      await writeSites(sites.map((site) => site.enabled ? { ...site, last_crawl: crawledAt, articles: site.articles + 1 } : site));
      return { taskId: handle.taskId } as T;
    }
    default:
      throw new Error(`Unsupported web-search action: ${action}`);
  }
}

export const api = {
  appletAction: runAction,
  search,
};
