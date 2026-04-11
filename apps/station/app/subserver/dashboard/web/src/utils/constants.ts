/**
 * Application-wide constants for page routing and API configuration.
 */

export const PAGES = {
  OVERVIEW: 'overview',
  ACTORS: 'actors',
  SESSIONS: 'sessions',
  NODES: 'nodes',
  SUBSERVERS: 'subservers',
  FEDERATION: 'federation',
  STORAGE: 'storage',
  SECURITY: 'security',
  SYSTEM: 'system',
  LOGS: 'logs',
} as const;

export type Page = typeof PAGES[keyof typeof PAGES];

export const API_BASE = '/dashboard/api';
