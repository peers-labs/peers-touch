export const DEFAULT_LARK_REQUESTER_DOMAINS = [
  'contact',
  'docs',
  'drive',
  'wiki',
] as const;

export const LARK_REQUESTER_DOMAIN_GROUPS = [
  {
    id: 'content',
    domains: ['contact', 'docs', 'drive', 'wiki', 'markdown', 'note'],
  },
  {
    id: 'planning',
    domains: ['calendar', 'task', 'approval', 'attendance', 'okr'],
  },
  {
    id: 'data',
    domains: ['base', 'sheets', 'slides'],
  },
  {
    id: 'communication',
    domains: ['im', 'mail', 'minutes', 'vc'],
  },
  {
    id: 'platform',
    domains: ['event', 'apps'],
  },
] as const;
